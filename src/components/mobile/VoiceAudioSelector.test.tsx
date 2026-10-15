import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { montage } from "../../test/interface";
import { VoiceAudioSelector } from "./VoiceAudioSelector";
import { watchAndroidVoiceAudio } from "../../services/androidVoiceAudio";
import type { AndroidVoiceAudioState } from "../../services/androidVoiceAudio";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: { device: string }) => values ? `${key}: ${values.device}` : key }) }));
const vue = montage();
const devices = [{ id: "1", type: "speaker", name: "Phone" }, { id: "3", type: "bluetooth", name: "My headset" }];
let state: AndroidVoiceAudioState;
let choose: ReturnType<typeof vi.fn>, buttonAction: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  state = { running: true, selected: "auto", active: "1", pending: null, error: null, interrupted: false, devices };
  choose = vi.fn(() => true); buttonAction = vi.fn();
  Object.assign(window, { __SION__: { voiceAudioState: () => JSON.stringify(state), chooseVoiceAudio: choose, setHeadsetButtonAction: buttonAction } });
});
afterEach(() => { delete (window as unknown as { __SION__?: unknown }).__SION__; vi.useRealTimers(); });
const notify = () => act(async () => { window.dispatchEvent(new Event("sion-voice-audio")); });
const open = async () => { await vue.click('[aria-label="voiceAudio.choose"]'); };
const radio = (id: string) => document.querySelector<HTMLInputElement>(`input[value="${id}"]`)!;

it("shows the confirmed route while a Bluetooth request is still pending", async () => {
  await vue.render(<VoiceAudioSelector connected />); await open();
  await act(async () => radio("3").click());
  expect(choose).toHaveBeenCalledWith("3");
  expect(radio("auto").checked).toBe(true);
  state = { ...state, selected: "3", pending: "3" }; await notify();
  expect(radio("3").checked).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("voiceAudio.switching");
  expect(vue.container.querySelector('button')?.textContent).toBe("voiceAudio.speaker");
  state = { ...state, active: "3", pending: null }; await notify();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("My headset");
});

it("removes an unplugged headset and reports the automatic fallback", async () => {
  state = { ...state, selected: "3", active: "3" };
  await vue.render(<VoiceAudioSelector connected />); await open();
  state = { ...state, selected: "auto", active: "1", devices: [devices[0]] }; await notify();
  expect(radio("3")).toBeNull();
  expect(radio("auto").checked).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("voiceAudio.speaker");
});

it("displays rejected routes and keeps manual choices available during an interruption", async () => {
  choose.mockReturnValue(false);
  await vue.render(<VoiceAudioSelector connected />); await open();
  await act(async () => radio("3").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("voiceAudio.routeFailed");
  state = { ...state, interrupted: true }; await notify();
  expect(radio("3").disabled).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("voiceAudio.interrupted");
});

it("saves the headset call-button action and restores it for another call", async () => {
  await vue.render(<VoiceAudioSelector connected />); await open();
  const select = document.querySelector('select')!;
  await act(async () => { select.value = "disconnect"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(buttonAction).toHaveBeenLastCalledWith("disconnect");
  expect(localStorage.getItem("sion-headset-action")).toBe("disconnect");
  await vue.render(<VoiceAudioSelector connected={false} />);
  await vue.render(<VoiceAudioSelector connected />);
  expect(buttonAction).toHaveBeenLastCalledWith("disconnect");
});

it("restores the trigger focus on Escape and hides controls without an Android bridge", async () => {
  await vue.render(<VoiceAudioSelector connected />); await open();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(vue.container.querySelector('button'));
  delete (window as unknown as { __SION__?: unknown }).__SION__;
  await notify();
  expect(vue.container.children).toHaveLength(0);
});

it("refreshes after resume and releases observers and polling on call teardown", async () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const stop = watchAndroidVoiceAudio(changed);
  state = { ...state, active: "3" };
  window.dispatchEvent(new Event("focus"));
  expect(changed).toHaveBeenLastCalledWith(state);
  stop(); changed.mockClear();
  window.dispatchEvent(new Event("sion-voice-audio"));
  document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(5000);
  expect(changed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("offers an explicit audio-focus retry without claiming that audio has already resumed", async () => {
  state = { ...state, interrupted: true };
  const resume = vi.fn(() => true);
  Object.assign((window as unknown as { __SION__: object }).__SION__, { resumeVoiceAudio: resume });
  await vue.render(<VoiceAudioSelector connected />); await open();
  const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === "voiceAudio.resume")!;
  await act(async () => button.click());
  expect(resume).toHaveBeenCalledOnce();
  expect(radio("3").disabled).toBe(false);
  state = { ...state, interrupted: false }; await notify();
  expect(radio("3").disabled).toBe(false);
});

it("selects the headset and explicitly resumes audio after focus loss", async () => {
  state = { ...state, interrupted: true };
  const resume = vi.fn(() => true);
  Object.assign((window as unknown as { __SION__: object }).__SION__, { resumeVoiceAudio: resume });
  await vue.render(<VoiceAudioSelector connected />); await open();
  await act(async () => radio("3").click());
  expect(choose).toHaveBeenCalledWith("3");
  expect(resume).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="status"]')?.textContent).toBe("voiceAudio.interrupted");
  state = { ...state, selected: "3", active: "3", interrupted: false }; await notify();
  expect(radio("3").checked).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("My headset");
});
