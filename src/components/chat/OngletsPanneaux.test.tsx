import { montage } from "../../test/interface";
import { beforeEach, expect, it, vi } from "vitest";
import { OngletsPanneaux } from "./OngletsPanneaux";
import { useLayoutStore } from "../../stores/useLayoutStore";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const vue = montage();
beforeEach(() => useLayoutStore.setState({ panneau: null }));
it("un clic ouvre le panneau, un second le ferme et l'état est accessible", async () => {
  await vue.render(<OngletsPanneaux salonVocal />);
  await vue.click('[aria-label="soundboard.title"]');
  expect(useLayoutStore.getState().panneau).toBe("soundboard");
  expect(vue.container.querySelector('[aria-label="soundboard.title"]')?.getAttribute("aria-pressed")).toBe("true");
  await vue.click('[aria-label="soundboard.title"]');
  expect(useLayoutStore.getState().panneau).toBeNull();
});
it("Transcription n'apparaît que dans un salon vocal", async () => {
  await vue.render(<OngletsPanneaux salonVocal={false} />);
  expect(vue.container.querySelector('[aria-label="transcript.title"]')).toBeNull();
  await vue.render(<OngletsPanneaux salonVocal />);
  expect(vue.container.querySelector('[aria-label="transcript.title"]')).not.toBeNull();
});
