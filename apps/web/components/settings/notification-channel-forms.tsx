"use client";

import { notificationEventCatalog } from "@boardreadyops/cloud-core/notifications";
import { useId, useState } from "react";
import type {
  createNotificationChannelAction,
  deleteNotificationChannelAction,
  updateNotificationChannelAction,
} from "../../app/settings/notifications/actions.js";
import { fieldError } from "../../lib/action-result.js";
import type { NotificationChannelView } from "../../lib/notification-admin.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { checkboxClassName } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

type KindOption = {
  value: string;
  label: string;
  hint: string;
  destinationLabel: string;
  destinationPlaceholder: string;
  destinationType: "email" | "url";
  destinationNote: string;
};

const credentialNote =
  "Stored as a credential and never shown in full again. Only the last few characters appear in the list below.";

const kindOptions: readonly KindOption[] = [
  {
    value: "slack",
    label: "Slack",
    hint: "Paste an incoming webhook URL from a Slack app. Messages arrive formatted, with a link back.",
    destinationLabel: "Incoming webhook URL",
    destinationPlaceholder: "https://hooks.slack.com/services/…",
    destinationType: "url",
    destinationNote: credentialNote,
  },
  {
    value: "email",
    label: "Email",
    hint: "One address. Use your mail system's own alias or distribution list to reach a group.",
    destinationLabel: "Address",
    destinationPlaceholder: "hardware-releases@example.com",
    destinationType: "email",
    destinationNote: "Shown partly masked in the list below, because it is personal data rather than a team URL.",
  },
  {
    value: "webhook",
    label: "Generic webhook",
    hint: "Any HTTPS endpoint you control. Receives the event as JSON rather than prose.",
    destinationLabel: "Endpoint URL",
    destinationPlaceholder: "https://hooks.example.com/boardreadyops",
    destinationType: "url",
    destinationNote: credentialNote,
  },
];

function EventCheckboxes({
  name,
  selected,
  idPrefix,
  componentIntelligenceReady,
}: Readonly<{
  name: string;
  selected: readonly string[];
  idPrefix: string;
  componentIntelligenceReady: boolean;
}>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">Tell me when…</legend>
      {notificationEventCatalog.map((event) => {
        const id = `${idPrefix}-${event.type}`;
        return (
          <div key={event.type} className="flex items-start gap-2.5">
            <input
              id={id}
              type="checkbox"
              name={name}
              value={event.type}
              defaultChecked={selected.includes(event.type)}
              className={`${checkboxClassName} mt-0.5`}
            />
            <label htmlFor={id} className="min-w-0">
              <span className="block text-sm text-foreground">{event.label}</span>
              <span className="block text-meta text-muted-foreground">{event.description}</span>
              {/*
                Supply watch only runs where a component-intelligence credential is configured.
                Ticking the box on a workspace without one produces silence, and silence reads
                like a broken notification rather than a missing prerequisite.
              */}
              {event.type === "supply.risk_detected" && !componentIntelligenceReady ? (
                <span className="block text-meta text-warning">
                  Needs a component-intelligence credential before it can fire — set one up under Settings → Component
                  Intelligence.
                </span>
              ) : null}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

export function NotificationChannelCreateForm({
  installationId,
  action,
  emailAvailable = false,
  componentIntelligenceReady = false,
}: Readonly<{
  installationId: string;
  action: typeof createNotificationChannelAction;
  /** Whether supply watch can actually run for this installation. */
  componentIntelligenceReady?: boolean;
  /**
   * Whether this deployment has an SMTP relay.
   *
   * The email option is absent rather than disabled when it is false: a greyed-out control
   * invites someone to work out how to enable it, and there is nothing they can do from here.
   */
  emailAvailable?: boolean;
}>) {
  const [kind, setKind] = useState<string>("slack");
  const [formKey, setFormKey] = useState(0);
  const kindId = useId();
  const labelId = useId();
  const destinationId = useId();
  const eventsId = useId();
  const available = kindOptions.filter((option) => option.value !== "email" || emailAvailable);
  const active = available.find((option) => option.value === kind) ?? available[0];
  const defaults = notificationEventCatalog.filter((event) => event.defaultOn).map((event) => event.type);

  return (
    <ActionForm
      key={formKey}
      action={action}
      className="flex flex-col gap-4"
      onSuccess={() => setFormKey((value) => value + 1)}
    >
      {({ state, pending }) => (
        <>
          <input type="hidden" name="installationId" value={installationId} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={kindId} className="text-sm font-medium text-foreground">
                Where
              </label>
              <NativeSelect
                id={kindId}
                name="kind"
                value={active?.value ?? kind}
                onChange={(event) => setKind(event.currentTarget.value)}
                className="mt-1 w-full"
              >
                {available.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              {active ? <p className="mt-1 text-meta text-muted-foreground">{active.hint}</p> : null}
            </div>

            <div>
              <label htmlFor={labelId} className="text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                id={labelId}
                name="label"
                maxLength={80}
                required
                placeholder="#hardware-releases"
                className="mt-1 w-full"
              />
              {fieldError(state, "label") ? (
                <p className="mt-1 text-meta text-danger">{fieldError(state, "label")}</p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor={destinationId} className="text-sm font-medium text-foreground">
              {active?.destinationLabel ?? "Destination"}
            </label>
            <Input
              id={destinationId}
              name="destination"
              type={active?.destinationType === "email" ? "email" : "url"}
              maxLength={2048}
              required
              placeholder={active?.destinationPlaceholder ?? ""}
              className="mt-1 w-full font-mono"
            />
            <p className="mt-1 text-meta text-muted-foreground">{active?.destinationNote ?? ""}</p>
            {fieldError(state, "destination") ? (
              <p className="mt-1 text-meta text-danger">{fieldError(state, "destination")}</p>
            ) : null}
          </div>

          <EventCheckboxes
            name="events"
            selected={defaults}
            idPrefix={eventsId}
            componentIntelligenceReady={componentIntelligenceReady}
          />

          <div className="flex justify-end border-t border-border pt-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add channel"}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function NotificationChannelEditForm({
  installationId,
  channel,
  updateAction,
  deleteAction,
  componentIntelligenceReady = false,
}: Readonly<{
  installationId: string;
  channel: NotificationChannelView;
  componentIntelligenceReady?: boolean;
  updateAction: typeof updateNotificationChannelAction;
  deleteAction: typeof deleteNotificationChannelAction;
}>) {
  const eventsId = useId();
  const enabledId = useId();

  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={updateAction} className="flex flex-col gap-3">
        {({ pending }) => (
          <>
            <input type="hidden" name="installationId" value={installationId} />
            <input type="hidden" name="channelId" value={channel.id} />

            <EventCheckboxes
              name="events"
              selected={channel.subscribedEvents}
              idPrefix={eventsId}
              componentIntelligenceReady={componentIntelligenceReady}
            />

            <div className="flex items-center gap-2.5">
              <input
                id={enabledId}
                type="checkbox"
                name="enabled"
                defaultChecked={channel.enabled}
                className={checkboxClassName}
              />
              <label htmlFor={enabledId} className="text-sm text-foreground">
                Deliver to this channel
              </label>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        )}
      </ActionForm>

      <ActionForm action={deleteAction} className="flex justify-end border-t border-border pt-3">
        {({ pending }) => (
          <>
            <input type="hidden" name="installationId" value={installationId} />
            <input type="hidden" name="channelId" value={channel.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              {pending ? "Removing…" : "Remove channel"}
            </Button>
          </>
        )}
      </ActionForm>
    </div>
  );
}
