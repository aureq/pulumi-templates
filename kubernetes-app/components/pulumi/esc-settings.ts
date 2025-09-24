import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as yaml from "yaml";
import * as git from "../../git";

interface PulumiEscSettingsArgs {
    prefixName: string,
}

export class PulumiEscSettings extends pulumi.ComponentResource {
    private readonly name: string;
    private readonly args: PulumiEscSettingsArgs;

    public readonly escEnvironment?: pulumiservice.Environment;

    /**
     * This is the class constructor. This method class all other private methods to correctly construct
     * the resources to connect to our AWS Account.
     *
     * @param name The base name for the resources created by this class
     * @param args The resource properties
     * @param opts Additional Pulumi CustomResourceOptions
     */
    constructor(name: string, args: PulumiEscSettingsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("custom:resource:pulumi-esc-settings", name, args, opts);
        this.name = name;
        this.args = args;

        const projectName = pulumi.getProject();
        let gitRemoteUrl = git.extractGitRemoteUrl("gh") || git.extractGitRemoteUrl("origin") || `https://github.com/aureq/${projectName}.git`;
        const repoInfos = git.extractGitRepository(gitRemoteUrl || "");

        // pulumi.log.info(`ℹ️  Git remote URL: ${gitRemoteUrl}`);
        // pulumi.log.info(`ℹ️  Git repository infos: ${repoInfos ? `${repoInfos.username}/${repoInfos.repoName}` : "not found"}`);

        if ((gitRemoteUrl?.includes("github.com/aureq") || gitRemoteUrl?.includes("github.com:aureq")) && repoInfos ) {

            const escEnv = {
                values:{
                    someSetting: "EXAMPLE-123",
                }
            }
            const escDoc = new yaml.Document(escEnv).toString();

            this.escEnvironment = new pulumiservice.Environment(`${this.args.prefixName}-app-secrets`, {
                name: pulumi.interpolate`${this.args.prefixName}-app-secrets-${pulumi.getStack()}`,
                organization: pulumi.getOrganization(),
                project: pulumi.getProject(),
                yaml: escDoc,
            }, { deleteBeforeReplace: true, parent: this });

            new pulumiservice.Webhook(`${this.args.prefixName}-webhook`, {
                organizationName: pulumi.getOrganization(),
                projectName: pulumi.getProject(),
                environmentName: this.escEnvironment.name,
                format: "pulumi_deployments",
                displayName: `${pulumi.getProject()}-${pulumi.getStack()}-webhook`,
                payloadUrl: `${pulumi.getProject()}/${pulumi.getStack()}`,
                groups: [
                    "environments",
                ],
                active: true,
            }, { parent: this.escEnvironment })
        }
    }
}