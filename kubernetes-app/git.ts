import * as fs from 'fs';

/**
 * `extractGitRemoteUrl()` extracts the remote URL for a given Git remote name.
 *
 * @param configFilePath The path where to find the git repository configuration file.
 * @param remoteName The Git remote name to look for.
 * @returns a string with the remote url, or null if the remote couldn't be found.
 */
export function extractGitRemoteUrl(remoteName: string, configFilePath?: string): string | null {

    if (!configFilePath) {
        configFilePath = "./.git/config";
    }

    try {
        // Read the .git/config file content
        const configContent = fs.readFileSync(configFilePath, 'utf8');

        // Split the content into lines
        const lines = configContent.split('\n');

        let isInTargetRemote = false;
        for (const line of lines) {
            // Match the remote block header
            const remoteHeaderMatch = line.match(/^\[remote \"(.+?)\"\]$/);

            if (remoteHeaderMatch) {
                const currentRemoteName = remoteHeaderMatch[1];
                isInTargetRemote = currentRemoteName === remoteName;
                continue;
            }

            // If inside the target remote block, look for the URL
            if (isInTargetRemote) {
                const urlMatch = line.match(/^\s*url\s*=\s*(.+)$/);
                if (urlMatch) {
                    return urlMatch[1].trim();
                }
            }
        }

        // If not found, return null
        return null;
    } catch (error) {
        return null;
    }
}

export function extractGitRepository(remoteUrl: string): { username: string; repoName: string } | null {
    const match = remoteUrl.match(/(?:github\.com[:\/])([^\/]+)\/([^\/]+)\.git$/);
    return match ? { username: match[1], repoName: match[2] } : null;
}
