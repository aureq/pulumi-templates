"""A Python Pulumi program"""

import pulumi
import pulumi_kubernetes as k8s

from components.lz import LandingZone
from components.cluster import CompliantCluster


config = pulumi.Config()

SERVICE_NAME = "eks-helm"

landing_zone = LandingZone(SERVICE_NAME,
    cidr_block=config.require("cidrBlock"),
    subnet_mask=config.require("subnetMask")
)

compliant_cluster = CompliantCluster(SERVICE_NAME,
    owner="aureq@pulumi.com",
    vpc_id=landing_zone.vpc.id,
    subnet_ids=landing_zone.public_subnet_ids,
    opts=pulumi.ResourceOptions(parent=landing_zone)
)

# Create a kubernetes Namespace to host our application
namespace = k8s.core.v1.Namespace(f"{SERVICE_NAME}-k8s-ns",
    metadata=k8s.meta.v1.ObjectMetaArgs(
        name=f"{SERVICE_NAME}-ns"
    ),
    opts=pulumi.ResourceOptions(
        depends_on=compliant_cluster.eks_cluster,
        deleted_with=compliant_cluster.eks_cluster,
        parent=compliant_cluster.eks_cluster,
        provider=compliant_cluster.kuberntes_provider,
    )
)

apache_chart = k8s.helm.v3.Chart(f"{SERVICE_NAME}-apache-chart", k8s.helm.v3.ChartOpts(
    namespace=namespace.metadata.name,
    chart='apache',
    version='11.2.4',
    fetch_opts={
        'repo': 'https://charts.bitnami.com/bitnami'
    }),
    opts=pulumi.ResourceOptions(
        parent=namespace,
        provider=compliant_cluster.kuberntes_provider
    )
)

# kubernetes_pod = k8s.core.v1.Pod(f"{SERVICE_NAME}-node",
#     metadata=k8s.meta.v1.ObjectMetaArgs(
#         name="my-exmplae-pod",
#         labels={
#             "app": "exmaple"
#         }
#     ),
#     spec=k8s.core.v1.PodSpecArgs(
#         containers=[k8s.core.v1.ContainerArgs(
#             name="my-container",
#             image="nginx",
#             ports=[k8s.core.v1.ContainerPortArgs(container_port=80)]
#         )]
#     )
# )

# Retrieve the k8s service for the Apache Helm Chart
apache_service = apache_chart.get_resource("v1/Service",
    f"{SERVICE_NAME}-apache-chart",
    namespace.metadata.name
)

pulumi.export("vpc_id", landing_zone.vpc.id)
pulumi.export("kubeconfig", compliant_cluster.kubeconfig)

# # Get the service public IP address
apache_service_hostname = apache_service.status.load_balancer.ingress[0].hostname
pulumi.export('apache_service_hostname', apache_service_hostname)
