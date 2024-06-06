import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as cmd from "@pulumi/command";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";
import { AvailabilityZones } from "./utils/aws/availabilityzones";
import { Vpc } from "./components/aws/vpc";
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";

const projectConfig = new pulumi.Config();

export = async () => {

    const serviceName = projectConfig.require("serviceName");
    const projectOwner = projectConfig.get("ownerEmail") || "devops@example.net";
    const dbUsername = projectConfig.get("dbUsername") || "dbadmin";
    const dbPassword = projectConfig.getSecret("dbPassword") || new random.RandomString(`${serviceName}-db-password`, {
        length: 29,
        numeric: true,
        lower: true,
        upper: true,
        special: false,
    }).result;

    const awsLinuxAmi = aws.ec2.getAmi({
        owners: ["amazon"],
        filters: [{
            name: "name",
            values: ["amzn2-ami-hvm-*-x86_64-ebs"],
        }],
        mostRecent: true,
    });

    const Azs = new AvailabilityZones(await AvailabilityZones.WithState('available'));
    const network = new Vpc(serviceName, {
        ownerEmail: projectOwner,
        cidrBlock: projectConfig.require('networkRange'),
        subnetMask: projectConfig.require('subnetMask'),
        availabilityZones: Azs.AvailabilityZonesNames,
    });

    const wpSecurityGroup = new aws.ec2.SecurityGroup(`${serviceName}-sg-wp`, {
        vpcId: network.vpc.id,
        description: 'Allow HTTP and TLS inbound traffic',
        tags: {
            Name: `${serviceName}-sg-wp`,
            'Requested-by': projectOwner,
        },
        ingress: [{
            cidrBlocks: ['0.0.0.0/0'],
            fromPort: 80,
            toPort: 80,
            protocol: 'tcp',
            description: 'HTTP into VPC'
        },{
            cidrBlocks: ['0.0.0.0/0'],
            fromPort: 443,
            toPort: 443,
            protocol: 'tcp',
            description: 'TLS into VPC'
        }],
        egress: [{
            cidrBlocks: ['0.0.0.0/0'],
            fromPort: 0,
            toPort: 0,
            protocol: '-1',
            description: 'ANY to ANY (outbound)'
        }],
    }, { parent: network.vpc, deleteBeforeReplace: true });

    const rdsSecurityGroup = new aws.ec2.SecurityGroup(`${serviceName}-sg-rds`, {
        vpcId: network.vpc.id,
        description: 'Allow MySQL inbound traffic',
        tags: {
            Name: `${serviceName}-sg-rds`,
            'Requested-by': projectOwner,
        },
        ingress: [{
            securityGroups: [wpSecurityGroup.id],
            fromPort: 3306,
            toPort: 3306,
            protocol: 'tcp',
            description: `MySQL into VPC from ${serviceName}-sg-wp`
        }],
        egress: [{
            cidrBlocks: ['0.0.0.0/0'],
            fromPort: 0,
            toPort: 0,
            protocol: '-1',
            description: 'ANY to ANY (outbound)'
        }],
    }, { parent: network.vpc, deleteBeforeReplace: true });

    const rdsSubnetGroup = new aws.rds.SubnetGroup(`${serviceName}-rds-subnet-group`, {
        subnetIds: network.privateSecurityGroupIds
    });

    const rdsDatabase = new aws.rds.Instance(`${serviceName}-rds-wordpress`, {
        allocatedStorage: 25,
        engine: "mariadb",
        instanceClass: "db.t3.small",
        dbSubnetGroupName: rdsSubnetGroup.id,
        vpcSecurityGroupIds: [rdsSecurityGroup.id],
        dbName: `${serviceName}-rds-wordpress`.replace(/-/g,""),
        username: dbUsername,
        password: dbPassword,
        skipFinalSnapshot: true,
    });

    const sshKeyPair = new tls.PrivateKey(`${serviceName}-ssh-key-pair`, { algorithm: "ED25519" });

    const wpKeypair = new aws.ec2.KeyPair(`${serviceName}-wordpress-keypair`, {
        publicKey: sshKeyPair.publicKeyOpenssh,
    });

    sshKeyPair.publicKeyOpenssh.apply(pubKey => {
        writeFileSync("tmp/id_ed25519.pub", pubKey, { mode: 0o600 });
    });

    sshKeyPair.privateKeyOpenssh.apply(privKey => {
        writeFileSync("tmp/id_ed25519", privKey, { mode: 0o600 });
    });

    const wpInstance = new aws.ec2.Instance(`${serviceName}-wp-instance`, {
        ami: awsLinuxAmi.then(awsLinuxAmi => awsLinuxAmi.id),
        instanceType: "t3.small",
        subnetId: network.publicSecurityGroupIds[0],
        vpcSecurityGroupIds: [wpSecurityGroup.id, network.securityGroupIds[0]],
        keyName: wpKeypair.id,
        tags: {
            Name: `${serviceName}-wp`,
            'Requested-by': projectOwner,
        },
    }, { dependsOn: [ rdsDatabase ]});

    const wpEip = new aws.ec2.Eip(`${serviceName}-wp-eip`, {
        instance: wpInstance.id
    }, { parent: wpInstance });

    if ( existsSync("tmp") !== true) mkdirSync("tmp");
    if ( existsSync("tmp/files") !== true) mkdirSync("tmp/files");
    copyFileSync("files/wp-config.php.j2", "tmp/files/wp-config.php.j2");

    const aptGetInstallCmd = new cmd.local.Command(`${serviceName}-apt-get-install`, {
        create: "apt-get install -V gettext-base ansible -y",
    });

    const renderPlaybookCmd = new cmd.local.Command(`${serviceName}-render-playbook`, {
        create: "wget -q -O - https://raw.githubusercontent.com/pulumi/examples/master/aws-ts-ansible-wordpress/playbook.yml | envsubst > tmp/playbook_rendered.yml",
        environment: {
            DB_RDS: rdsDatabase.endpoint,
            DB_NAME: rdsDatabase.dbName,
            DB_USERNAME: dbUsername,
            DB_PASSWORD: dbPassword,
        },
    }, { dependsOn: [ aptGetInstallCmd ]});

    const updatePythonCmd = new cmd.remote.Command(`${serviceName}-update-python`, {
        connection: {
            host: wpEip.publicIp,
            port: 22,
            user: "ec2-user",
            privateKey: sshKeyPair.privateKeyOpenssh,
        },
        create: `(sudo yum update -y || true); (sudo yum install python35 -y); (sudo yum install amazon-linux-extras -y);`,
    });

    const playAnsiblePlaybookCmd = new cmd.local.Command(`${serviceName}-play-ansible-playbook`, {
        create: pulumi.interpolate`ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -u ec2-user -i '${wpEip.publicIp},' --private-key tmp/id_ed25519 tmp/playbook_rendered.yml`
    }, { dependsOn: [renderPlaybookCmd, updatePythonCmd] });

    return {
        owner: projectOwner,
        dbUsername: dbUsername,
        dbPassword: pulumi.secret(dbPassword),
        sshPrivateKey: sshKeyPair.privateKeyOpenssh,
        sshPublicKey: sshKeyPair.publicKeyOpenssh,
        host: wpEip.publicDns,
        ip: wpEip.publicIp,
    }
}