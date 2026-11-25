import "server-only";
import QRCode from "qrcode";
import { qrPayload } from "@/lib/students";

/**
 * QR code as an SVG string. It encodes ONLY the opaque token
 * ("ATT1:<random>") - no name, ID or school - so a photographed card
 * reveals nothing about the student.
 */
export async function qrSvg(token: string): Promise<string> {
  return QRCode.toString(qrPayload(token), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}
