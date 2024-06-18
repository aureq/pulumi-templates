"""Custom manage cluster"""

import base64
import pulumi
import pulumi_azuread as azuread
import pulumi_kubernetes as k8s
import pulumi_tls as tls

from pulumi.resource import ResourceOptions
from pulumi_azure_native import containerservice

class K8sClusterComponent(pulumi.ComponentResource):
    """Custom Kubernetes Cluster Component"""
    def __init__(self, name, service_name, resource_group_name, opts=None):
        super().__init__('pkg:index:Cluster', name, {}, opts)

        # Create an AD service principal
        ad_app = azuread.Application(f"{service_name}-aks",
                                     display_name=f"{service_name}-aks",
                                     opts=ResourceOptions(parent=self))

        ad_sp = azuread.ServicePrincipal(f"{service_name}-aks-sp",
                                         client_id=ad_app.client_id,
                                         opts=ResourceOptions(parent=self))

        # Create the Service Principal Password
        ad_sp_password = azuread.ServicePrincipalPassword(f"{service_name}-aks-sp-password",
                                                        service_principal_id=ad_sp.id,
                                                        end_date="2099-01-01T00:00:00Z",
                                                        opts=ResourceOptions(parent=self))

        # Generate an SSH key
        ssh_key = tls.PrivateKey(f"{service_name}-ssh-key",
                                 algorithm="RSA",
                                 rsa_bits=4096,
                                 opts=ResourceOptions(parent=self))

        # Create the managed cluster
        managed_cluster_name = f"{service_name}-cluster"
        self.managed_cluster = containerservice.ManagedCluster(
            managed_cluster_name,
            resource_group_name=resource_group_name,
            agent_pool_profiles=[{
                "count": 3,
                "max_pods": 11,
                "mode": "System",
                "name": "agentpool",
                "node_labels": {},
                "os_disk_size_gb": 30,
                "os_type": "Linux",
                "type": "VirtualMachineScaleSets",
                "vm_size": "Standard_DS2_v2",
            }],
            enable_rbac=True,
            kubernetes_version="1.29.2",
            linux_profile={
                "admin_username": "aureq",
                "ssh": {
                    "public_keys": [{
                        "key_data": ssh_key.public_key_openssh,
                    }],
                },
            },
            dns_prefix=resource_group_name,
            node_resource_group=f"{managed_cluster_name}-node-rg",
            service_principal_profile={
                "client_id": ad_app.client_id,
                "secret": ad_sp_password.value
            },
            opts=ResourceOptions(parent=self))

        creds = containerservice.list_managed_cluster_user_credentials_output(
            resource_group_name=resource_group_name,
            resource_name=self.managed_cluster.name)

        encoded = creds.kubeconfigs[0].value

        self.kubeconfig = pulumi.Output.secret(encoded.apply(
            lambda enc: base64.b64decode(enc).decode()))

        self.provider = k8s.Provider(f"{service_name}-k8s-provider",
                                     kubeconfig=self.kubeconfig,
                                     opts=ResourceOptions(parent=self))
