import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { montage } from "../test/interface";

const mock = vi.hoisted(() => ({
  source: vi.fn(), stop: vi.fn(), listen: vi.fn(),
  callback: null as ((event: { open: boolean; sender: string | null }) => void) | null,
}));
vi.mock("../services/voiceNativeService", () => ({
  onVoiceNativePip: mock.listen,
  pipNativeSources: mock.source,
  pipNativeOpenStreams: vi.fn(() => Promise.resolve(true)),
  pipNativeClose: vi.fn(() => Promise.resolve()),
}));
import { useNativePip } from "./useNativePip";

const vue = montage();
function View({ name }: { name: string }) {
  const pip = useNativePip();
  return <span data-view={name}>{pip.sender ?? "fermé"}</span>;
}
beforeEach(() => {
  mock.source.mockReset(); mock.stop.mockReset(); mock.listen.mockReset();
  mock.source.mockResolvedValue([]);
  mock.listen.mockImplementation((callback) => { mock.callback = callback; return Promise.resolve(mock.stop); });
});

it("partage un abonnement entre webcam et partage d’écran, puis le libère", async () => {
  await vue.render(<><View key="camera" name="camera" /><View key="share" name="share" /></>);
  expect(mock.listen).toHaveBeenCalledOnce();
  await act(async () => mock.callback!({ open: true, sender: "camera:@alice:example.org:PC" }));
  expect(document.querySelector('[data-view="camera"]')?.textContent).toBe("camera:@alice:example.org:PC");
  expect(document.querySelector('[data-view="share"]')?.textContent).toBe("camera:@alice:example.org:PC");
  await vue.render(<View key="share" name="share" />);
  expect(mock.stop).not.toHaveBeenCalled();
  await vue.render(null);
  expect(mock.stop).toHaveBeenCalledOnce();
});

it("une ancienne réponse de statut ne remplace pas le flux d’un événement plus récent", async () => {
  let resolveSource!: (source: string[]) => void;
  mock.source.mockReturnValue(new Promise<string[]>((resolve) => { resolveSource = resolve; }));
  await vue.render(<View name="camera" />);
  await act(async () => mock.callback!({ open: true, sender: "camera:@alice:example.org:PC" }));
  await act(async () => resolveSource(["@bob:example.org:PC"]));
  expect(document.querySelector('[data-view="camera"]')?.textContent).toBe("camera:@alice:example.org:PC");
  await act(async () => mock.callback!({ open: false, sender: null }));
  expect(document.querySelector('[data-view="camera"]')?.textContent).toBe("fermé");
});
