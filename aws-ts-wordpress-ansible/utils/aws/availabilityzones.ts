// see https://betterprogramming.pub/how-to-write-an-async-class-constructor-in-typescript-javascript-7d7e8325c35e
import * as aws from "@pulumi/aws";

type AvailabilityZonesOptions = (az: AvailabilityZones) => void

export class AvailabilityZones {

    public AvailabilityZonesNames: string[] = [];

    constructor(...options: AvailabilityZonesOptions[]) {
        for (const option of options) {
            option(this)
        }
    }

    public static async WithState(state: string, provider?: aws.Provider): Promise<AvailabilityZonesOptions> {
        const data = await aws.getAvailabilityZones({ state: state });
        return (az: AvailabilityZones): void => {
            az.AvailabilityZonesNames = data.names;
        }
    }
}
