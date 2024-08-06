"""
Landzing Zone Component resource.
All you need to have a beautiful Landing Zone
"""
from typing import Optional, List, Tuple
import ipaddress

import pulumi
import pulumi_aws as aws


class LandingZone(pulumi.ComponentResource):
    """
    Landzing Zone Component resource
    """

    vpc: aws.ec2.Vpc
    """
    The VPC resource instantiated with this Component Resrouces
    """

    igw: aws.ec2.InternetGateway
    """
    The Internet Gateway instantiated with this Component Resrouces
    """

    public_route_table: aws.ec2.RouteTable
    """
    The VPC public route table
    """

    public_subnets: List[aws.ec2.Subnet]
    """
    The public subnet in this VPC
    """

    public_subnet_ids: List[pulumi.Output[str]]
    """
    The public subnet IDs in this VPC
    """

    private_subnets: List[aws.ec2.Subnet]
    """
    The private subnet in this VPC
    """

    security_group: aws.ec2.SecurityGroup
    """
    The main security group in this VPC for administrative purpose only
    """

    def __init__(self, name,
                 cidr_block: Optional[str],
                 subnet_mask: Optional[str],
                 opts=None):
        """
        Class constructor
        """
        super().__init__('custom:components:LandingZone', name, {}, opts)

        self.name = name

        if cidr_block is not None:
            self.cidr_block = cidr_block
        else:
            self.cidr_block = "10.255.0.0/16"

        if subnet_mask is not None:
            self.subnet_mask = subnet_mask
        else:
            self.subnet_mask = "255.255.240.0"

        network_with_netmask = ipaddress.IPv4Network(f'0.0.0.0/{subnet_mask}', strict=False)
        main_network = ipaddress.ip_network(address=self.cidr_block)
        self._subnets = list(main_network.subnets(new_prefix=network_with_netmask.prefixlen))

        self._zones = aws.get_availability_zones()

        self.vpc = self._create_vpc()
        self.igw = self._create_internet_gateway()
        self.public_route_table = self._create_route_table()

        self.public_subnets, self.public_subnet_ids = self._create_public_subnets()
        self.private_subnets = self._create_private_subnets()

        self.security_group = self._create_security_group()

    def _create_vpc(self) -> aws.ec2.Vpc:
        """
        Create our VPC
        """
        return aws.ec2.Vpc(f"{self.name}-vpc",
            cidr_block=self.cidr_block,
            enable_dns_support=True,
            enable_dns_hostnames=True,
            opts=pulumi.ResourceOptions(
                parent=self
            )
        )

    def _create_internet_gateway(self) -> aws.ec2.InternetGateway:
        """
        Create the internet gateway in our VPC
        """
        return aws.ec2.InternetGateway(f"{self.name}-igw",
            vpc_id=self.vpc.id,
            opts=pulumi.ResourceOptions(
                parent=self.vpc
            )
        )

    def _create_public_subnets(self) -> Tuple[List[aws.ec2.Subnet], List[pulumi.Output[str]]]:
        """
        Create a public Subnet in our VPC and make it publicly accessible
        """

        _subnets: List[aws.ec2.Subnet] = []
        _subet_ids: List[pulumi.Output[str]] = []

        for zone in self._zones.names:
            _subnet = aws.ec2.Subnet(f"{self.name}-subnet-public-{zone}",
                vpc_id=self.vpc.id,
                cidr_block=str(self._subnets.pop()),
                availability_zone=zone,
                map_public_ip_on_launch=True,
                opts=pulumi.ResourceOptions(
                    parent=self.vpc
                )
            )

            _rta = aws.ec2.RouteTableAssociation(f"{self.name}-rta-public-{zone}",
                subnet_id=_subnet.id,
                route_table_id=self.public_route_table.id,
                opts=pulumi.ResourceOptions(
                    parent=self.public_route_table
                )
            )

            _subnets.append(_subnet)
            _subet_ids.append(_subnet.id)

        return _subnets, _subet_ids

    def _create_private_subnets(self) -> List[aws.ec2.Subnet]:
        """
        Create a private Subnet in our VPC
        """

        _subnets: List[aws.ec2.Subnet] = []

        for zone in self._zones.names:
            _subnet = aws.ec2.Subnet(f"{self.name}-subnet-private-{zone}",
                vpc_id=self.vpc.id,
                cidr_block=str(self._subnets.pop()),
                availability_zone=zone,
                map_public_ip_on_launch=True,
                opts=pulumi.ResourceOptions(
                    parent=self.vpc
                )
            )

            _subnets.append(_subnet)

        return _subnets

    def _create_route_table(self) -> aws.ec2.RouteTable:
        """
        Create a (public) route table in our VPC
        """
        return aws.ec2.RouteTable(f"{self.name}-rt-public",
            vpc_id=self.vpc.id,
            routes=[aws.ec2.RouteTableRouteArgs(
                cidr_block="0.0.0.0/0",
                gateway_id=self.igw.id
            )],
            opts=pulumi.ResourceOptions(
                parent=self.vpc
            )
        )

    def _create_security_group(self) -> aws.ec2.SecurityGroup:
        """
        Create the administrative security group
        """
        return aws.ec2.SecurityGroup(f"{self.name}-sg-admin",
            vpc_id=self.vpc.id,
            ingress=[aws.ec2.SecurityGroupIngressArgs(
                protocol="tcp",
                from_port=22,
                to_port=22,
                cidr_blocks=["0.0.0.0/0"]
            )],
            opts=pulumi.ResourceOptions(
                parent=self.vpc
            )
        )
