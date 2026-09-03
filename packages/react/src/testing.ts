/**
 * The fake transport `@domainkit/react` tests render against: an in-memory `domainkit/server`
 * with memory storage and a fake provider, recording every call.
 */
import { Testing } from "domainkit/testing";

export const transport = Testing.transport;
export type RecordedCall = Testing.RecordedCall;
export type RecordingTransport = Testing.RecordingTransport;
export type TransportOptions = Testing.TransportOptions;
