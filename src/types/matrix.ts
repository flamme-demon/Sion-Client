export type UserRole = "admin" | "mod" | "user";
export type MatrixPresence = "online" | "offline" | "unavailable";

interface MatrixUser {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  presence?: MatrixPresence;
}

/** Un appareil en appel (`call.member`). */
export interface VoiceDevice {
  id: string;
  muted: boolean;
  deafened: boolean;
  /** sion_platform identifies mobile devices (android, ios). */
  mobile: boolean;
}

export interface VoiceChannelUser extends MatrixUser {
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  /** LiveKit-reported connection quality. Undefined when offline / not in voice. */
  connectionQuality?: "excellent" | "good" | "poor" | "lost" | "unknown";
  /** Emoji displayed during an active soundboard trigger; undefined when idle. */
  playingSoundEmoji?: string;
  /**
   * One call.member per device: the same user can join from desktop and phone
   * with different microphone states.
   */
  devices?: VoiceDevice[];
  /** All this user's devices in the call are phones. */
  mobileOnly?: boolean;
  /** This call entry represents a phone device. */
  mobile?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  topic?: string;
  icon?: string;
  hasVoice: boolean;
  voiceUsers: VoiceChannelUser[];
  createdAt: number;
  lastActivity: number;
  isDM?: boolean;
  dmUserId?: string;
  isSoundboard?: boolean;
  /** Matrix space (m.room.create.type=m.space), hidden from chat. */
  isSpace?: boolean;
  /** Valid m.space.child room IDs belonging to this space. */
  spaceChildren?: string[];
  commonRoomIds?: string[];
  /** Sound/meme library designated by the space. */
  boardRoomId?: string;
  membership?: "join" | "invite";
}

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  /** Direct HTTP media URL; points to encrypted content when encryptedFile is present. */
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  /** Present for E2EE media; decrypt before displaying. */
  encryptedFile?: {
    url: string;
    key: { alg: string; key_ops: string[]; kty: string; k: string; ext: boolean };
    iv: string;
    hashes: Record<string, string>;
    v: string;
  };
}

export interface ChatMessage {
  id: number | string;
  /** Matrix event ID */
  eventId?: string;
  /** Matrix transaction ID matching local echo to the server response. */
  transactionId?: string;
  /** Echo from this app launch, retained until sync returns it. */
  localEcho?: boolean;
  sending?: boolean;
  /** Matrix user ID (e.g., @user:server.com) */
  senderId?: string;
  /** Display name for the user */
  user: string;
  role: UserRole;
  avatarUrl?: string;
  time: string;
  /** Original event timestamp in milliseconds — used for day separators */
  ts?: number;
  text: string;
  /** HTML formatted body (org.matrix.custom.html) */
  formattedBody?: string;
  /** Message type (m.text, m.notice, m.emote) */
  msgtype?: string;
  attachments?: FileAttachment[];
  /** Whether this message has been edited */
  edited?: boolean;
  /** Reply reference */
  replyTo?: { eventId: string; senderId?: string; user?: string; text?: string; msgtype?: string; attachmentName?: string };
  /** Reactions on this message */
  reactions?: { emoji: string; count: number; userIds: string[]; eventIds: Record<string, string> }[];
  /** Poll data (MSC3381) when this message is an m.poll.start event. */
  poll?: PollData;
}

export interface PollData {
  question: string;
  /** "disclosed" = results visible before the poll ends; "undisclosed" = hidden until end. */
  kind: "disclosed" | "undisclosed";
  maxSelections: number;
  answers: { id: string; text: string }[];
  /** Latest vote per voter: senderId → selected answer ids. */
  votes: Record<string, string[]>;
  /** True once an explicit m.poll.end was received. */
  ended: boolean;
  /** Optional auto-close deadline (epoch ms). Clients close the poll locally past this. */
  endsTs?: number;
}
