"""
Fully compliant EKS cluster Component resource.
Fully compliant and standardized EKS cluster, ready for app deployments
"""
import json
from typing import Optional, List

import pulumi
import pulumi_aws as aws
import pulumi_eks as eks
import pulumi_kubernetes as k8s

class CompliantCluster(pulumi.ComponentResource):
    """
    Compliant EKS Component resource
    """

    vpc_id: pulumi.Input[str]
    """
    The VPC ID used to hosted our EKS cluster
    """

    subnet_ids: List[pulumi.Input[str]]
    """
    A list of subnets used to deploy our EKS nodes
    """

    owner: Optional[pulumi.Input[str]]
    """
    The project owner who is responsible for this EKS cluster
    """

    iam_eks_cluster_role:  aws.iam.Role
    """
    The EKS CLuster role
    """

    cluster_security_group: aws.ec2.SecurityGroup
    """
    The Security Group used on this Cluster
    """

    eks_cluster: eks.Cluster
    """
    The actual EKS cluster managing our nodes
    """

    node_group: eks.ManagedNodeGroup
    """
    The worker nodes for the EKS cluster
    """

    kubeconfig: pulumi.Output[str]
    """
    The raw `KUBECONFIG` to access this EKS cluster
    """

    kuberntes_provider: k8s.Provider
    """
    A valid Pulumi Kubernetes provider to manage this EKS cluster
    """

    def __init__(self, name,
                 owner: Optional[pulumi.Input[str]],
                 vpc_id: pulumi.Input[str],
                 subnet_ids: List[pulumi.Input[str]],

                 opts=None):
        """
        Class constructor
        """
        super().__init__('custom:components:CompliantCluster', name, {}, opts)

        self.name = name
        self.vpc_id = vpc_id
        self.subnet_ids = subnet_ids

        if owner is not None:
            self.owner = owner
        else:
            self.owner = "unclaimed-project@example.net"

        self.iam_eks_cluster_role = self._create_iam_eks_cluster_role()
        # self.iam_node_group_role = self._create_iam_node_group_role()
        self.cluster_security_group = self._create_eks_security_group()
        self.eks_cluster = self._create_cluster()
        self.node_group = self._create_node_group()
        self.kubeconfig = self._generate_kubeconfig()
        self.kuberntes_provider = self._create_kubernetes_provider()

    def _create_iam_eks_cluster_role(self) -> aws.iam.Role:
        """
        Create the necessary IAM role to operate our EKS cluster
        """

        _managed_policy_arns = [
            "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
            "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
            "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
            "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
        ]

        _role = aws.iam.Role(f"{self.name}-eks-iam-role",
            assume_role_policy=json.dumps({
                'Version': '2012-10-17',
                'Statement': [{
                    'Action': 'sts:AssumeRole',
                    'Principal': {
                        'Service': 'ec2.amazonaws.com'
                    },
                    'Effect': 'Allow',
                    'Sid': ''
                }],
            }),
            opts=pulumi.ResourceOptions(
                parent=self,
            )
        )

        for i, policy in enumerate(_managed_policy_arns):
            aws.iam.RolePolicyAttachment(f"{self.name}-eks-iam-role-policy-{i}",
                policy_arn=policy,
                role=_role.id,
                opts=pulumi.ResourceOptions(parent=_role)
            )

        return _role

    # def _create_iam_node_group_role(self) -> aws.iam.Role:
    #     """
    #     Create the necessaru IAM role to operate the EKS Node Group
    #     """

    #     _managed_policy_arns = [
    #         "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    #         "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    #         "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    #         "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    #     ]

    #     _role = aws.iam.Role(f"{self.name}-ec2-nodegroup-iam-role",
    #         assume_role_policy=json.dumps({
    #             'Version': '2012-10-17',
    #             'Statement': [{
    #                 'Action': 'sts:AssumeRole',
    #                 'Principal': {
    #                     'Service': 'ec2.amazonaws.com'
    #                 },
    #                 'Effect': 'Allow',
    #                 'Sid': ''
    #             }],
    #         }),
    #         opts=pulumi.ResourceOptions(parent=self)
    #     )

    #     for i, policy in enumerate(_managed_policy_arns):
    #         aws.iam.RolePolicyAttachment(f"{self.name}-eks-node-group-iam-role-policy-{i}",
    #             policy_arn=policy,
    #             role=_role.id,
    #             opts=pulumi.ResourceOptions(parent=_role)
    #         )


    #     # aws.iam.RolePolicyAttachment(f"{self.name}-eks-workernode-policy-attachment",
    #     #     role=_role.id,
    #     #     policy_arn='arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
    #     #     opts=pulumi.ResourceOptions(parent=_role)
    #     # )


    #     # aws.iam.RolePolicyAttachment(f"{self.name}-eks-cni-policy-attachment",
    #     #     role=_role.id,
    #     #     policy_arn='arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
    #     #         opts=pulumi.ResourceOptions(parent=_role)
    #     # )

    #     # aws.iam.RolePolicyAttachment(f"{self.name}-ec2-container-(ro-policy-attachment)",
    #     #     role=_role.id,
    #     #     policy_arn='arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
    #     #     opts=pulumi.ResourceOptions(parent=_role)
    #     # )

    #     return _role

    def _create_eks_security_group(self) -> aws.ec2.SecurityGroup:
        """
        Create a security group for the EKS cluster
        """

        return aws.ec2.SecurityGroup(f"{self.name}-eks-cluster-sg",
            vpc_id=self.vpc_id,
            description='Allow all HTTP(s) traffic to EKS Cluster',
            tags={
                'Owner': self.owner,
            },
            ingress=[
                aws.ec2.SecurityGroupIngressArgs(
                    cidr_blocks=['0.0.0.0/0'],
                    from_port=443,
                    to_port=443,
                    protocol='tcp',
                    description='Allow pods to communicate with the cluster API Server.'
                ),
                aws.ec2.SecurityGroupIngressArgs(
                    cidr_blocks=['0.0.0.0/0'],
                    from_port=80,
                    to_port=80,
                    protocol='tcp',
                    description='Allow internet access to pods'
                )
            ],
            opts=pulumi.ResourceOptions(parent=self)
        )

    def _create_cluster(self) -> aws.eks.Cluster | eks.Cluster:
        """
        Create the EKS cluster
        """
        return eks.Cluster(f"{self.name}-eks-cluster",
            vpc_id=self.vpc_id,
            subnet_ids=self.subnet_ids,
            create_oidc_provider=True,
            storage_classes="gp2",
            instance_roles=[self.iam_eks_cluster_role],
            version="1.30",
            enabled_cluster_log_types=[
                "api",
                "audit",
                "authenticator",
                "controllerManager",
                "scheduler"
            ],
            skip_default_node_group=True,
            tags={
                'Owner': self.owner
            },
            opts=pulumi.ResourceOptions(
                parent=self,
                depends_on=[self.iam_eks_cluster_role]
            )
        )
        # return aws.eks.Cluster(f"{self.name}-eks-cluster",
        #     role_arn=self.iam_eks_cluster_role.arn,
        #     tags={
        #         'Owner': self.owner,
        #     },
        #     vpc_config=aws.eks.ClusterVpcConfigArgs(
        #         public_access_cidrs=['0.0.0.0/0'],
        #         security_group_ids=[self.cluster_security_group.id],
        #         subnet_ids=self.subnet_ids,
        #     ),
        #     opts=pulumi.ResourceOptions(
        #         parent=self,
        #         depends_on=[self.iam_eks_cluster_role],
        #         additional_secret_outputs=["certificate_authority"]
        #     )
        # )

    def _create_node_group(self) -> aws.eks.NodeGroup:
        """
        Create the cluster worker nodes
        """

        return eks.ManagedNodeGroup(f"{self.name}-eks-managed-node-group",
            cluster=self.eks_cluster,
            instance_types=["t3.medium"],
            node_role=self.iam_eks_cluster_role,
            subnet_ids=self.subnet_ids,
            scaling_config=aws.eks.NodeGroupScalingConfigArgs(
                desired_size=2,
                max_size=2,
                min_size=1,
            ),
            tags={
                'Owner': self.owner,
            },
            opts=pulumi.ResourceOptions(
                parent=self.eks_cluster,
                custom_timeouts=pulumi.CustomTimeouts(create='10m')
            )
        )
        # return aws.eks.NodeGroup(f"{self.name}-eks-node-group",
        #     cluster_name=self.eks_cluster.name,
        #     node_group_name=f"{self.name}-pulumi-eks-nodegroup",
        #     node_role_arn=self.iam_node_group_role.arn,
        #     subnet_ids=self.subnet_ids,
        #     tags={
        #         'Owner': self.owner,
        #     },
        #     scaling_config=aws.eks.NodeGroupScalingConfigArgs(
        #         desired_size=2,
        #         max_size=2,
        #         min_size=1,
        #     ),
        #     opts=pulumi.ResourceOptions(
        #         parent=self.eks_cluster,
        #         custom_timeouts=pulumi.CustomTimeouts(create='10m')
        #     )
        # )

    def _generate_kubeconfig(self) -> pulumi.Output[str]:
        """
        Securely generate the KUBECONFIG from our deployed cluster
        """

        return pulumi.Output.secret(self.eks_cluster.get_kubeconfig())



    #     return pulumi.Output.json_dumps({
    #         "apiVersion": "v1",
    #         "clusters": [
    #             {
    #                 "cluster": {
    #                     "server": self.eks_cluster.endpoint,
    #                     "certificate-authority-data": self.eks_cluster.certificate_authority.apply(lambda v: v.data),
    #                 },
    #                 "name": "kubernetes",
    #             },
    #         ],
    #         "contexts": [
    #             {
    #                 "context": {
    #                     "cluster": "kubernetes",
    #                     "user": "aws",
    #                 },
    #                 "name": "aws",
    #             },
    #         ],
    #         "current-context": "aws",
    #         "kind": "Config",
    #         "users": [
    #             {
    #                 "name": "aws",
    #                 "user": {
    #                     "exec": {
    #                         "apiVersion": "client.authentication.k8s.io/v1beta1",
    #                         "command": "aws",
    #                         "args": [
    #                             "eks",
    #                             "get-token",
    #                             "--cluster-name",
    #                             self.eks_cluster.name,
    #                             "--output",
    #                             "json"


    #                         ],
    #                         # "env": envvars,
    #                     },
    #                 },
    #             },
    #         ],
    #     })

    #     # return pulumi.Output.json_dumps({
    #     #     "apiVersion": "v1",
    #     #     "clusters": [{
    #     #         "cluster": {
    #     #             "server": self.eks_cluster.endpoint,
    #     #             # pylint: disable=line-too-long
    #     #             "certificate-authority-data": self.eks_cluster.certificate_authority.apply(lambda v: v.data)
    #     #         },
    #     #         "name": "kubernetes",
    #     #     }],
    #     #     "contexts": [{
    #     #         "context": {
    #     #             "cluster": "kubernetes",
    #     #             "user": "aws",
    #     #         },
    #     #         "name": "aws",
    #     #     }],
    #     #     "current-context": "aws",
    #     #     "kind": "Config",
    #     #     "users": [{
    #     #         "name": "aws",
    #     #         "user": {
    #     #             "exec": {
    #     #                 "apiVersion": "client.authentication.k8s.io/v1beta1",
    #     #                 "command": "aws-iam-authenticator",
    #     #                 "args": [
    #     #                     "token",
    #     #                     "-i",
    #     #                     self.eks_cluster.endpoint,
    #     #                 ],
    #     #             },
    #     #         },
    #     #     }],
    #     # })

    def _create_kubernetes_provider(self) -> k8s.Provider:
        """
        Create the matching Kubernetes provider
        """

        return k8s.Provider(f"{self.name}-k8s-provider",
            kubeconfig=self.kubeconfig,
            opts=pulumi.ResourceOptions(parent=self)
        )
