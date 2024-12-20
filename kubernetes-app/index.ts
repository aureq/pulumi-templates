import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const appConfig = new pulumi.Config();

export = async () => {

    const serviceName = appConfig.require("serviceName");

    const appLabels = {
        "app.kubernetes.io/name": "nginx",
        "app.kubernetes.io/managed-by": "Pulumi",
        "app.kubernetes.io/owner": appConfig.require("owner"),
    };

    const clusterProvider = new k8s.Provider(`${serviceName}-cluster-provider`, {
        kubeconfig: appConfig.require("kubeconfig")
    });


    const appNamespace = new k8s.core.v1.Namespace(`${serviceName}-ns`, {
        metadata: {
            labels: appLabels
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
                spec: { containers: [{ name: "nginx", image: "nginx" }] }
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
            }],
            type: "LoadBalancer",
        }
    }, { provider: clusterProvider, parent: appNamespace });

    return {
        name: appDeployment.metadata.name,
        serviceEndpoint: appService.status.apply(s => s.loadBalancer.ingress[0].hostname ? s.loadBalancer.ingress[0].hostname : s.loadBalancer.ingress[0].ip),
        healthCheckCommand: appService.status.apply(s => `wget -O - -q http://${s.loadBalancer.ingress[0].hostname ? s.loadBalancer.ingress[0].hostname : s.loadBalancer.ingress[0].ip}`),
        driftCommand: pulumi.all([appNamespace.metadata.name, appDeployment.metadata.name]).apply(([namespaceName, deploymentName]) => `KUBECONFIG='/tmp/aureq/kubeconfig' pulumi env run ${pulumi.getOrganization()}/demos/cluster-access -- kubectl -n ${namespaceName} label deployment ${deploymentName} app.kubernetes.io/owner-`)
    };
}
