import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { removeHelmHooksTransformation } from "./utils/helm";

const appConfig = new pulumi.Config();

export = async() => {

    // Create a programmatic provider to access our
    // kubernetes cluster based on the the top level
    // stack output.
    const k8sProvider = new k8s.Provider("appCluster-provider", {
        kubeconfig: appConfig.require("kubeconfig"),
    });

    const serviceName = appConfig.require("serviceName");

    const standardLabels = {
        "app.kubernetes.io/name": serviceName,
        "app.kubernetes.io/managed-by": "Pulumi",
        "app.kubernetes.io/owner": appConfig.require("owner"),
    }

    const namespace = new k8s.core.v1.Namespace("checkout-app", {
        metadata: {
            labels: {
                ...standardLabels
            },
        }
    }, {
        provider: k8sProvider,
        parent: k8sProvider,
    });

    const appLabels = {
        ...standardLabels,
        appClass: serviceName,
    }

    const deployment = new k8s.apps.v1.Deployment(`${serviceName}-deployment-app`, {
        metadata: {
            namespace: namespace.metadata.name,
            labels: appLabels,
        },
        spec: {
            replicas: 1,
            selector: { matchLabels: appLabels },
            template: {
                metadata: {
                    labels: appLabels,
                },
                spec: {
                    containers: [
                        {
                            name: serviceName,
                            image: "nginx:latest",
                            ports: [{ name: "http", containerPort: 80 }],
                        },
                    ],
                },
            },
        },
    }, { provider: k8sProvider, parent: namespace });

    const service = new k8s.core.v1.Service(`${serviceName}-loadbalancer`, {
        metadata: {
            labels: appLabels,
            namespace: namespace.metadata.name,
        },
        spec: {
            type: "LoadBalancer",
            ports: [{ port: 80, targetPort: "http" }],
            selector: appLabels,
        },
    }, { provider: k8sProvider, parent: namespace });

    // let _chart = new k8s.helm.v3.Chart(`${serviceName}-chart-ingress`, {
    //     chart: "ingress-nginx",
    //     version: "3.35.0",
    //     namespace: namespace.metadata.name,
    //     fetchOpts:{
    //         repo: "https://kubernetes.github.io/ingress-nginx",
    //     },
    //     values: {
    //         controller: {
    //             admissionWebhooks: {
    //                 enabled: false
    //             },
    //             service: {
    //                 labels: appLabels,
    //             }
    //         }
    //     },
    // }, { parent: namespace, provider: k8sProvider, transformations:[removeHelmHooksTransformation] });

    return {
        serviceName: service.metadata.name,
        servicePublicIP: service.status.loadBalancer.ingress[0].ip,
        servicePublicEndpoint: pulumi.interpolate`http://${service.status.loadBalancer.ingress[0].ip}/`,
    }
}
