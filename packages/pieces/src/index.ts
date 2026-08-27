export { slackPiece, sendMessage, newMessage } from "./slack";
export { httpPiece, httpRequest } from "./http";

import { httpPiece } from "./http";
import { slackPiece } from "./slack";
import type { PieceDef } from "@algoverge/pieces-sdk";

export const firstPartyPieces: PieceDef[] = [slackPiece, httpPiece];
