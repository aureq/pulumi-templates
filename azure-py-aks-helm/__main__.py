"""An Azure RM Python Pulumi program"""

import pulumi
import pulumi_kubernetes as k8s

from pulumi_azure_native import resources
from pulumi.resource import ResourceOptions
from pulumi_kubernetes.helm.v3 import Chart, ChartOpts
from components.cluster import K8sClusterComponent as cluster_component

config = pulumi.Config()

service_name = config.require("service_name")

# Create new resource group
resource_group = resources.ResourceGroup(f"{service_name}-rg")

app_cluster = cluster_component(f"{service_name}-cluster-component",
                                service_name,
                                resource_group.name)

namespace = k8s.core.v1.Namespace(f"{service_name}-k8s-ns",
                                  metadata=k8s.meta.v1.ObjectMetaArgs(
                                      name="my-app-ns"
                                  ),opts=ResourceOptions(
                                      depends_on=app_cluster.managed_cluster,
                                      deleted_with=app_cluster.managed_cluster,
                                      provider=app_cluster.provider,
                                  ))

apache_chart = Chart(f"{service_name}-apache-chart", ChartOpts(
    namespace=namespace.metadata.name,
    chart='apache',
    version='11.2.4',
    fetch_opts={'repo': 'https://charts.bitnami.com/bitnami'}),
    ResourceOptions(provider=app_cluster.provider))

apache_service = apache_chart.get_resource("v1/Service",
                                           f"{service_name}-apache-chart",
                                           namespace.metadata.name)
apache_service_ip = apache_service.status.load_balancer.ingress[0].ip

pulumi.export("kubeconfig", app_cluster.kubeconfig)
pulumi.export('apache_service_ip', apache_service_ip)
