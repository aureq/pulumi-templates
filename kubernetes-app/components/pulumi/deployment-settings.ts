import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as git from "../../git";

interface PulumiDeploymentSettingsArgs {
    /**
     * prefix used in the name of the resources
     */
    prefixName: string,
    /**
     * An optional access token to use as part of the deployment settings.
     */
    accessToken?: string,
}

export class PulumiDeploymentSettings extends pulumi.ComponentResource {
    private readonly name: string;
    private readonly args: PulumiDeploymentSettingsArgs;

    public readonly deploymentSettings?: pulumiservice.DeploymentSettings;
    public readonly driftSchedule?: pulumiservice.DriftSchedule;

    public readonly reviewStack?: pulumiservice.Stack;
    public readonly reviewStackSettings?: pulumiservice.DeploymentSettings;

    /**
     * This is the class constructor. This method class all other private methods to correctly construct
     * the resources to connect to our AWS Account.
     *
     * @param name The base name for the resources created by this class
     * @param args The resource properties
     * @param opts Additional Pulumi CustomResourceOptions
     */
    constructor(name: string, args: PulumiDeploymentSettingsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("custom:resource:pulumi-deployment-settings", name, args, opts);
        this.name = name;
        this.args = args;

        const projectName = pulumi.getProject();
        let gitRemoteUrl = git.extractGitRemoteUrl("gh") || git.extractGitRemoteUrl("origin") || `https://github.com/aureq/${projectName}.git`;
        const repoInfos = git.extractGitRepository(gitRemoteUrl || "");

        // pulumi.log.info(`ℹ️  Git remote URL: ${gitRemoteUrl}`);
        // pulumi.log.info(`ℹ️  Git repository infos: ${repoInfos ? `${repoInfos.username}/${repoInfos.repoName}` : "not found"}`);

        if ((gitRemoteUrl?.includes("github.com/aureq") || gitRemoteUrl?.includes("github.com:aureq")) && repoInfos ) {

            let operationContext = undefined;
            if (this.args.accessToken) {
                operationContext = {
                    environmentVariables: {
                        "PULUMI_ACCESS_TOKEN": this.args.accessToken
                    }
                };
            }

            if ( pulumi.getStack() === "prod" ) {

                /**
                 * Set the DeploymentSettings to our own `prod` stack
                 */
                this.deploymentSettings = new pulumiservice.DeploymentSettings(`${args.prefixName}-deployment-settings`, {
                    organization: pulumi.getOrganization(),
                    project: pulumi.getProject(),
                    stack: pulumi.getStack(),
                    github: {
                        repository: `${repoInfos.username}/${repoInfos.repoName}`,
                        /**
                         * On merge, deploy changes to the stack
                         */
                        deployCommits: true,
                        previewPullRequests: false,
                        /**
                         * Make this stack a review stack template only.
                         * No resources are going to be deployed in this stack.
                         */
                        pullRequestTemplate: false,
                    },
                    sourceContext: {
                        git: {
                            branch: "main"
                        }
                    },
                    cacheOptions: {
                        enable: true,
                    },
                    operationContext: operationContext,
                }, { parent: this, deleteBeforeReplace: true });

                // Let's create a Pulumi DeploymentSchedule for drift detection
                this.driftSchedule = new pulumiservice.DriftSchedule(`${args.prefixName}-drift-detection`, {
                    organization: pulumi.getOrganization(),
                    project: pulumi.getProject(),
                    stack: pulumi.getStack(),
                    autoRemediate: false,              // only warn about drift, do not remediate.
                    scheduleCron: "*/5 * * * *",
                    //               | | | | |
                    //               | | | | |         // see https://man7.org/linux/man-pages/man5/crontab.5.html
                    //               | | | | \-------- day of week
                    //               | | | \---------- month
                    //               | | \------------ day of the month
                    //               | \-------------- hour
                    //               \---------------- minutes
                }, { dependsOn: [this.deploymentSettings], parent: this.deploymentSettings, deleteBeforeReplace: true });

                /**
                 * Create an empty stack for the purpose of review stacks
                 */
                this.reviewStack = new pulumiservice.Stack(`${args.prefixName}-review-stack`, {
                    organizationName: pulumi.getOrganization(),
                    projectName: pulumi.getProject(),
                    stackName: "review-stack",
                });

                /**
                 * Set the DeploymentSettings for the `review-stack` template
                 */
                this.reviewStackSettings = new pulumiservice.DeploymentSettings(`${args.prefixName}-review-stack-deployment-settings`, {
                    organization: pulumi.getOrganization(),
                    project: pulumi.getProject(),
                    stack: this.reviewStack.stackName,
                    github: {
                        repository: `${repoInfos.username}/${repoInfos.repoName}`,
                        deployCommits: false,
                        previewPullRequests: false,
                        pullRequestTemplate: true,
                    },
                    sourceContext: {
                        git: {
                            branch: "main"
                        }
                    },
                    cacheOptions: {
                        enable: true,
                    },
                    operationContext: operationContext,
                }, { parent: this.reviewStack, deleteBeforeReplace: true });

            }
        }
    }
}