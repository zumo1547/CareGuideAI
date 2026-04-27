import type { ScanGuidanceState } from "@/types/domain";

export interface DetectionFrame {
  frameWidth: number;
  frameHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE_RATIO = 0.14;
const MAX_SIZE_RATIO = 0.58;
const CENTER_TOLERANCE_RATIO = 0.15;

export const computeScanGuidance = (
  frame: DetectionFrame | null | undefined,
): ScanGuidanceState => {
  if (!frame) {
    return "move_closer";
  }

  const barcodeCenterX = frame.x + frame.width / 2;
  const barcodeCenterY = frame.y + frame.height / 2;
  const frameCenterX = frame.frameWidth / 2;
  const frameCenterY = frame.frameHeight / 2;

  const offsetXRatio = (barcodeCenterX - frameCenterX) / frame.frameWidth;
  const offsetYRatio = (barcodeCenterY - frameCenterY) / frame.frameHeight;

  if (offsetXRatio < -CENTER_TOLERANCE_RATIO) return "move_left";
  if (offsetXRatio > CENTER_TOLERANCE_RATIO) return "move_right";
  if (offsetYRatio < -CENTER_TOLERANCE_RATIO) return "move_up";
  if (offsetYRatio > CENTER_TOLERANCE_RATIO) return "move_down";

  const sizeRatio = Math.max(
    frame.width / frame.frameWidth,
    frame.height / frame.frameHeight,
  );

  if (sizeRatio < MIN_SIZE_RATIO) return "move_closer";
  if (sizeRatio > MAX_SIZE_RATIO) return "move_away";

  return "hold_steady";
};

export const guidanceToThaiSpeech = (state: ScanGuidanceState) => {
  switch (state) {
    case "move_left":
      return "ขยับไปทางซ้ายเล็กน้อย";
    case "move_right":
      return "ขยับไปทางขวาเล็กน้อย";
    case "move_up":
      return "ยกกล้องขึ้นอีกนิด";
    case "move_down":
      return "เลื่อนกล้องลงอีกนิด";
    case "move_closer":
      return "ขยับเข้าใกล้ยาอีกนิด";
    case "move_away":
      return "ถอยกล้องออกอีกนิด";
    case "hold_steady":
      return "ดีมาก ค้างไว้เพื่อสแกน";
    default:
      return "กำลังช่วยเล็งยา";
  }
};
