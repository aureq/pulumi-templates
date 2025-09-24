import * as fs from 'fs';
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as pulumiDeploymentSettings from "./components/pulumi/deployment-settings";
import * as pulumiEscSettings from "./components/pulumi/esc-settings";
import * as verboseComponent from "@aureq/verbose-component";

const appConfig = new pulumi.Config();

export = async () => {

    const serviceName = appConfig.require("serviceName");
    const owner = appConfig.require("owner");

    const appLabels = {
        "app.kubernetes.io/name": "nginx",
        "app.kubernetes.io/managed-by": "Pulumi",
        "app.kubernetes.io/owner": owner,
    };

    const clusterProvider = new k8s.Provider(`${serviceName}-cluster-provider`, {
        kubeconfig: appConfig.requireSecret("kubeconfig")
    });


    const appNamespace = new k8s.core.v1.Namespace(`${serviceName}-ns`, {
        metadata: {
            labels: appLabels,
            name: `${serviceName}-ns-${pulumi.getStack()}`
        }
    }, { provider: clusterProvider, parent: clusterProvider });

    const appDeployment = new k8s.apps.v1.Deployment(`${serviceName}-invoice`, {
        metadata: {
            namespace: appNamespace.metadata.name,
            labels: appLabels
        },
        spec: {
            selector: { matchLabels: appLabels },
            replicas: 1,
            template: {
                metadata: { labels: appLabels },
                spec: {
                    containers: [{
                        name: "nginx",
                        image: "nginxinc/ingress-demo:latest",
                        // image: "paulbouwer/hello-kubernetes:1",
                        env: [{
                            name: "DATABASE_PASSWORD",
                            value:  appConfig.require("dbPassword"),
                        }]
                    }]
                }
            }
        }
    }, { provider: clusterProvider, parent: appNamespace });

    const appService = new k8s.core.v1.Service(`${serviceName}-loadbalancer`, {
        metadata: {
            labels: appLabels,
            namespace: appNamespace.metadata.name,
        },
        spec: {
            selector: appLabels,
            ports: [{
                port: 80,
                protocol: "TCP",
                targetPort: 80,
                // targetPort: 8080,
            }],
            type: "LoadBalancer",
        }
    }, { provider: clusterProvider, parent: appNamespace });

    const stackDeploymentSetting = new pulumiDeploymentSettings.PulumiDeploymentSettings(`${serviceName}-deployment-setting`, {
        prefixName: serviceName,
        accessToken: appConfig.get("orgAccessToken"),
    });

    const stackEscSetting = new pulumiEscSettings.PulumiEscSettings(`${serviceName}-esc-settings`, {
        prefixName: serviceName,
    });

    const vc = new verboseComponent.VerboseComponent(`${serviceName}-verbose`, {
        prefixName: serviceName,
    });

    // pulumi convert --from terraform --generate-only --language typescript --out converted/
    // unmanaged-s3-bucket-ap-southeast-2-aureq
    // , { import: "unmanaged-s3-bucket-ap-southeast-2-aureq", retainOnDelete: true }

    return {
        name: appDeployment.metadata.name,
        serviceEndpoint: appService.status.apply(s => s.loadBalancer.ingress[0].hostname ? s.loadBalancer.ingress[0].hostname : s.loadBalancer.ingress[0].ip),
        healthCheckCommand: appService.status.apply(s => `wget -O - -q http://${s.loadBalancer.ingress[0].hostname ? s.loadBalancer.ingress[0].hostname : s.loadBalancer.ingress[0].ip}`),
        driftCommand: pulumi.all([appNamespace.metadata.name, appDeployment.metadata.name]).apply(([namespaceName, deploymentName]) => `pulumi env run ${pulumi.getOrganization()}/demos/cluster-access -- kubectl -n ${namespaceName} label deployment ${deploymentName} app.kubernetes.io/owner-`),
        k9sCommand: pulumi.all([appNamespace.metadata.name, appDeployment.metadata.name]).apply(([namespaceName, deploymentName]) => `pulumi env run -i ${pulumi.getOrganization()}/demos/cluster-access -- k9s`),
        kubeconfig: appConfig.requireSecret("kubeconfig"),
    };
}
