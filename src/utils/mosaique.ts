import type { ChatMessage } from "../types/matrix";

export interface GroupeMessages {
  debut: number;
  messages: ChatMessage[];
}

function imageSeule(message: ChatMessage): boolean {
  return !!message.senderId && !!message.eventId && Number.isFinite(message.ts)
    && !message.text.trim() && !message.formattedBody && !message.replyTo && !message.poll && !message.edited
    && message.attachments?.length === 1 && message.attachments[0].mimeType.startsWith("image/");
}

function memeJour(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Regroupement visuel seulement : les événements et leurs références restent
 * intacts. Aucun marqueur propre à Sion n'est nécessaire aux clients tiers. */
export function groupesImages(messages: readonly ChatMessage[], debutNonLus = -1): GroupeMessages[] {
  const groupes: GroupeMessages[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const groupe = groupes.at(-1);
    const premiere = groupe?.messages[0];
    const precedente = groupe?.messages.at(-1);
    const rapprochee = precedente?.ts !== undefined && message.ts !== undefined
      && premiere?.ts !== undefined && message.ts >= precedente.ts
      && message.ts - precedente.ts <= 60_000 && message.ts - premiere.ts <= 180_000
      && memeJour(premiere.ts, message.ts);
    if (groupe && groupe.messages.length < 10 && i !== debutNonLus && rapprochee
      && imageSeule(message) && imageSeule(precedente!) && message.senderId === premiere?.senderId) {
      groupe.messages.push(message);
    } else {
      groupes.push({ debut: i, messages: [message] });
    }
  }
  return groupes;
}

export function ratioImage(message: ChatMessage): number {
  const image = message.attachments?.[0];
  const ratio = image?.width && image.height ? image.width / image.height : 1;
  return Number.isFinite(ratio) && ratio > 0 ? Math.max(.5, Math.min(2, ratio)) : 1;
}

/** Rangées jointives de 1 à 3 images, avec des hauteurs proches et les
 * proportions du média plutôt qu'un recadrage systématique en carré. */
export function lignesMosaique(messages: ChatMessage[]): ChatMessage[][] {
  const couts = new Map<number, { cout: number; lignes: ChatMessage[][] }>();
  const chercher = (debut: number): { cout: number; lignes: ChatMessage[][] } => {
    if (debut === messages.length) return { cout: 0, lignes: [] };
    const connue = couts.get(debut); if (connue) return connue;
    let meilleure = { cout: Infinity, lignes: [] as ChatMessage[][] };
    for (let n = 1; n <= 3 && debut + n <= messages.length; n++) {
      const ligne = messages.slice(debut, debut + n);
      const largeur = ligne.reduce((s, m) => s + ratioImage(m), 0);
      const suite = chercher(debut + n);
      const cout = (1 / largeur - 1 / 3.25) ** 2 + (n === 1 && messages.length > 1 ? .12 : 0) + suite.cout;
      if (cout < meilleure.cout) meilleure = { cout, lignes: [ligne, ...suite.lignes] };
    }
    couts.set(debut, meilleure); return meilleure;
  };
  return chercher(0).lignes;
}
