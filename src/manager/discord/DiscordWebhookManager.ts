import config from '../../../config';

export default class DiscordWebhookManager {
    private discordHookCount: number = 0;
    private discordHookIndex: number = 0;

    private discordHookMaxCount: number = config.discordHookMaxCount;
    private discordHooks: string[] = config.discordHooks;
    private cachedHooks: string[] = [];

    public hasAvailableWebhook(): boolean {
        return this.discordHooks.length > 0;
    }

    public getAvailableWebhook(): string | null {
        if (this.discordHooks.length === 0) {
            return null;
        }

        const webhook = this.discordHooks.shift()!;
        this.cachedHooks.push(webhook);
        return webhook;
    }

    public releaseWebhook(webhook: string): void {
        const index = this.cachedHooks.indexOf(webhook);

        if (index !== -1) {
            this.cachedHooks.splice(index, 1);
            this.discordHooks.push(webhook);
        }
    }

    public async getWebhook(): Promise<string> {
        await this.updateWebhookIndex();
        return this.discordHooks[this.discordHookIndex];
    }

    private async updateWebhookIndex(): Promise<void> {
        return new Promise((resolve) => {
            if (this.discordHookCount++ >= this.discordHookMaxCount) {
                this.discordHookCount = 0;
                this.discordHookIndex = (this.discordHookIndex + 1) % this.discordHooks.length;
            }
            resolve();
        });
    }
}