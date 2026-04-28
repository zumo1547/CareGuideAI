interface MedicationKnowledgeEntry {
  aliases: string[];
  thaiName: string;
  useTh: string;
  symptomReliefTh: string[];
}

const MEDICATION_KNOWLEDGE: MedicationKnowledgeEntry[] = [
  {
    aliases: ["paracetamol", "acetaminophen", "tylenol", "panadol"],
    thaiName: "พาราเซตามอล",
    useTh: "ยาแก้ปวด ลดไข้",
    symptomReliefTh: ["ไข้", "ปวดศีรษะ", "ปวดเมื่อยกล้ามเนื้อ", "ปวดฟัน"],
  },
  {
    aliases: ["ibuprofen", "brufen", "nurofen"],
    thaiName: "ไอบูโพรเฟน",
    useTh: "ยาแก้ปวด ลดอักเสบ ลดไข้ (กลุ่ม NSAIDs)",
    symptomReliefTh: ["ปวดข้อ", "ปวดกล้ามเนื้อ", "ปวดประจำเดือน", "ไข้"],
  },
  {
    aliases: ["diclofenac", "voltaren"],
    thaiName: "ไดโคลฟีแนค",
    useTh: "ยาแก้ปวด ลดการอักเสบ (กลุ่ม NSAIDs)",
    symptomReliefTh: ["ปวดข้อ", "ปวดกล้ามเนื้อ", "อักเสบจากข้อเสื่อม"],
  },
  {
    aliases: ["amoxicillin", "amoxil"],
    thaiName: "อะม็อกซีซิลลิน",
    useTh: "ยาปฏิชีวนะรักษาการติดเชื้อแบคทีเรีย",
    symptomReliefTh: ["เจ็บคอจากเชื้อแบคทีเรีย", "ไซนัสอักเสบ", "ติดเชื้อทางเดินหายใจ"],
  },
  {
    aliases: ["amoxicillin clavulanate", "augmentin", "co-amoxiclav"],
    thaiName: "อะม็อกซีซิลลิน/คลาวูลาเนต",
    useTh: "ยาปฏิชีวนะสำหรับการติดเชื้อแบคทีเรีย",
    symptomReliefTh: ["ติดเชื้อทางเดินหายใจ", "ติดเชื้อผิวหนัง", "ไซนัสอักเสบ"],
  },
  {
    aliases: ["metformin", "glucophage"],
    thaiName: "เมตฟอร์มิน",
    useTh: "ยาควบคุมระดับน้ำตาลในผู้ป่วยเบาหวานชนิดที่ 2",
    symptomReliefTh: ["น้ำตาลในเลือดสูง", "เบาหวานชนิดที่ 2"],
  },
  {
    aliases: ["amlodipine", "amlopress", "norvasc"],
    thaiName: "แอมโลดิพีน",
    useTh: "ยาลดความดันโลหิต และลดอาการเจ็บหน้าอกจากหัวใจขาดเลือด",
    symptomReliefTh: ["ความดันโลหิตสูง", "เจ็บหน้าอก (angina)"],
  },
  {
    aliases: ["losartan", "cozaar"],
    thaiName: "โลซาร์แทน",
    useTh: "ยาลดความดันโลหิต (กลุ่ม ARB)",
    symptomReliefTh: ["ความดันโลหิตสูง", "ป้องกันภาวะแทรกซ้อนทางไตในผู้ป่วยเบาหวาน"],
  },
  {
    aliases: ["simvastatin", "zocor", "atorvastatin", "lipitor", "rosuvastatin", "crestor"],
    thaiName: "ยากลุ่มสแตติน",
    useTh: "ยาลดไขมันในเลือด",
    symptomReliefTh: ["คอเลสเตอรอลสูง", "ลดความเสี่ยงโรคหัวใจและหลอดเลือด"],
  },
  {
    aliases: ["omeprazole", "losec", "pantoprazole", "esomeprazole", "lansoprazole"],
    thaiName: "ยากลุ่มยับยั้งกรดในกระเพาะ (PPI)",
    useTh: "ลดกรดในกระเพาะอาหาร",
    symptomReliefTh: ["กรดไหลย้อน", "แสบท้อง", "แผลในกระเพาะอาหาร"],
  },
  {
    aliases: ["cetirizine", "zyrtec"],
    thaiName: "เซทิริซีน",
    useTh: "ยาแก้แพ้กลุ่มต้านฮีสตามีน",
    symptomReliefTh: ["น้ำมูกไหล", "จาม", "คันจมูก", "ผื่นลมพิษ"],
  },
  {
    aliases: ["loratadine", "claritin"],
    thaiName: "ลอราทาดีน",
    useTh: "ยาแก้แพ้กลุ่มต้านฮีสตามีน",
    symptomReliefTh: ["น้ำมูกไหล", "จาม", "คันตา", "ผื่นลมพิษ"],
  },
  {
    aliases: ["desloratadine", "aerius"],
    thaiName: "เดสลอราทาดีน",
    useTh: "ยาแก้แพ้กลุ่มต้านฮีสตามีน",
    symptomReliefTh: ["น้ำมูกไหล", "จาม", "คันจมูก", "คันตา", "ผื่นลมพิษ"],
  },
  {
    aliases: ["aspirin", "acetylsalicylic acid"],
    thaiName: "แอสไพริน",
    useTh: "ยาแก้ปวดลดไข้ และใช้ต้านเกล็ดเลือดในบางขนาดยา",
    symptomReliefTh: ["ปวด", "ไข้", "ลดความเสี่ยงลิ่มเลือด (ตามแพทย์สั่ง)"],
  },
];

const normalizeAlias = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b(tablet|tablets|tab|capsule|capsules|cap|film coated|mg|mcg|ml)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const aliasIndex = new Map<string, MedicationKnowledgeEntry>();
for (const entry of MEDICATION_KNOWLEDGE) {
  for (const alias of entry.aliases) {
    aliasIndex.set(normalizeAlias(alias), entry);
  }
}

export interface MedicationKnowledgeResolution {
  thaiName: string;
  useTh: string;
  symptomReliefTh: string[];
}

export const resolveMedicationKnowledge = (
  candidates: Array<string | null | undefined>,
): MedicationKnowledgeResolution | null => {
  const normalizedCandidates = candidates
    .map((candidate) => (candidate ? normalizeAlias(candidate) : ""))
    .filter(Boolean);

  for (const candidate of normalizedCandidates) {
    const exact = aliasIndex.get(candidate);
    if (exact) {
      return {
        thaiName: exact.thaiName,
        useTh: exact.useTh,
        symptomReliefTh: exact.symptomReliefTh,
      };
    }

    for (const [alias, entry] of aliasIndex.entries()) {
      if (candidate.includes(alias) || alias.includes(candidate)) {
        return {
          thaiName: entry.thaiName,
          useTh: entry.useTh,
          symptomReliefTh: entry.symptomReliefTh,
        };
      }
    }
  }

  return null;
};

const INDICATION_KEYWORD_MAP: Array<{ pattern: RegExp; th: string }> = [
  { pattern: /allergic rhinitis|allergy|urticaria|hives/i, th: "อาการแพ้ / ลมพิษ" },
  { pattern: /fever|pyrexia/i, th: "ไข้" },
  { pattern: /pain|analgesic|headache|migraine/i, th: "อาการปวด" },
  { pattern: /hypertension|blood pressure/i, th: "ความดันโลหิตสูง" },
  { pattern: /diabetes|blood glucose|glycemic/i, th: "เบาหวาน / น้ำตาลในเลือดสูง" },
  { pattern: /infection|bacterial|antibiotic/i, th: "การติดเชื้อแบคทีเรีย" },
  { pattern: /cough|cold|respiratory/i, th: "อาการทางเดินหายใจ" },
  { pattern: /gastric|acid reflux|gerd|ulcer|heartburn/i, th: "กรดไหลย้อน / โรคกระเพาะ" },
  { pattern: /cholesterol|lipid/i, th: "ไขมันในเลือดสูง" },
  { pattern: /angina|cardiac/i, th: "อาการเจ็บหน้าอกจากหัวใจ" },
];

const sanitizeIndication = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^\W+|\W+$/g, "")
    .trim();

export const summarizeIndicationFromExternal = (indicationRaw: string | null | undefined) => {
  if (!indicationRaw) {
    return {
      indicationTh: null,
      symptomTagsTh: [] as string[],
    };
  }

  const indication = sanitizeIndication(indicationRaw);
  if (!indication) {
    return {
      indicationTh: null,
      symptomTagsTh: [] as string[],
    };
  }

  const tags = INDICATION_KEYWORD_MAP.filter((item) => item.pattern.test(indication)).map(
    (item) => item.th,
  );
  const uniqueTags = [...new Set(tags)];

  return {
    indicationTh: uniqueTags.length
      ? `ใช้สำหรับ${uniqueTags.join(" / ")}`
      : "มีข้อมูลการใช้ยาจากฐานข้อมูลภายนอก กรุณาอ่านฉลากและคำสั่งแพทย์ประกอบ",
    symptomTagsTh: uniqueTags,
  };
};
