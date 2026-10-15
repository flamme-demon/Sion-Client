const MEDIA_TYPES = new Set(["m.image", "m.video", "m.audio", "m.file"]);

/** An edit replaces the content, so captions must carry the original media. */
export function messageEditContent(original: Record<string, unknown>, target: string, text: string): Record<string, unknown> {
  if (typeof original.msgtype !== "string" || !original.msgtype) throw new Error("Message original indisponible ou indéchiffrable");
  const relation = original["m.relates_to"] as Record<string, unknown> | undefined;
  if (relation?.rel_type === "m.replace") throw new Error("L'édition doit viser le message d'origine");
  const next = { ...original };
  if (MEDIA_TYPES.has(original.msgtype)) {
    const file = original.file as Record<string, unknown> | undefined;
    if (![original.url, file?.url].some((url) => typeof url === "string" && !!url)) {
      throw new Error("Le média du message original est indisponible");
    }
    if (typeof next.filename !== "string" || !next.filename) next.filename = original.body ?? "fichier";
  }
  for (const key of ["format", "formatted_body", "m.mentions", "m.new_content", "m.relates_to"]) delete next[key];
  next.body = text;
  return {
    ...next,
    body: `* ${text}`,
    "m.new_content": next,
    "m.relates_to": { rel_type: "m.replace", event_id: target },
  };
}
