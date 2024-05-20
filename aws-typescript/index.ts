import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { AvailabilityZones } from "./utils/aws/availabilityzones";
import { Vpc } from "./components/aws/vpc";

const projectConfig = new pulumi.Config();

export = async () => {

    const serviceName = projectConfig.require("serviceName");

    const projectOwner = projectConfig.get("ownerEmail") || "devops@example.net";

    const Azs = new AvailabilityZones(await AvailabilityZones.WithState('available'));
    const network = new Vpc(serviceName, {
        ownerEmail: projectOwner,
        cidrBlock: projectConfig.require('networkRange'),
        subnetMask: projectConfig.require('subnetMask'),
        availabilityZones: Azs.AvailabilityZonesNames,
    });

    return {
        owner: projectOwner,
    }
}