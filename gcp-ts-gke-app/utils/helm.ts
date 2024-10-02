import * as pulumi from "@pulumi/pulumi";

export const removeHelmHooksTransformation = ( o: pulumi.ResourceTransformationArgs ): pulumi.ResourceTransformationResult => {
    if (o.props?.metadata?.annotations?.["helm.sh/hook"]) {
        const {
            "helm.sh/hook": junk,
            "helm.sh/hook-delete-policy": junk2,
            ...validAnnotations
        } = o.props.metadata.annotations;

        return {
            props: {
                ...o.props,
                metadata: {
                    ...o.props.metadata,
                    annotations: validAnnotations,
                },
            },
            opts: o.opts,
        }
    }
    return o;
};
