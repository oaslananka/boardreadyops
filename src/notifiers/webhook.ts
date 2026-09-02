import type { WebhookNotifierConfig } from "../core/config.js";
import { envValue, type HttpNotifierDependencies, isRecognizedWebhookEnvName, postJson } from "./http.js";
import {
  isNotifierEnabled,
  type NotificationPayload,
  type NotificationResult,
  type Notifier,
  type NotifierId,
} from "./Notifier.js";

export abstract class WebhookNotifierBase implements Notifier {
  abstract readonly id: NotifierId;

  protected constructor(
    private readonly config: WebhookNotifierConfig,
    private readonly dependencies: HttpNotifierDependencies = {},
  ) {}

  isAvailable(): boolean {
    return isNotifierEnabled(this.config) && Boolean(this.webhookUrl());
  }

  async notify(payload: NotificationPayload): Promise<NotificationResult> {
    const webhookUrl = this.webhookUrl();
    if (!webhookUrl) {
      return { notifier: this.id, status: "skipped", reason: "unavailable" };
    }
    if (!isRecognizedWebhookEnvName(this.config.webhookEnv)) {
      this.dependencies.logger?.warn("notifier.webhook.unrecognized-env-name", {
        notifier: this.id,
        webhookEnv: this.config.webhookEnv,
      });
    }
    await postJson(this.dependencies.fetcher, webhookUrl, this.body(payload));
    return { notifier: this.id, status: "sent" };
  }

  protected abstract body(payload: NotificationPayload): unknown;

  private webhookUrl(): string | undefined {
    return envValue(this.dependencies.env, this.config.webhookEnv);
  }
}
