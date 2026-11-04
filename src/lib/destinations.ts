/**
 * Destinations a room can be created for. Each one is a card deck (a subset of cards.json),
 * a short brief the planning agent reads, and a hero card for the landing page.
 * Adding a destination = adding cards to cards.json and an entry here.
 */
export type Destination = {
  key: string;
  label: string;
  tagline: string;
  cities: string[];
  cardIds: string[];
  heroCard: string;
  /** Sentence(s) the agent uses to decide the city split. */
  brief: string;
  /** Soon: shown in the picker but not selectable. */
  comingSoon?: boolean;
};

const TOKYO = ["senso-ji", "tsukiji-outer-market", "shibuya-crossing", "teamlab-planets", "meiji-shrine", "golden-gai", "akihabara", "tokyo-skytree"];
const KYOTO = ["fushimi-inari", "arashiyama-bamboo", "kinkaku-ji", "nishiki-market", "gion-evening", "philosophers-path", "pontocho", "kiyomizu-dera"];
const OSAKA = ["dotonbori", "osaka-castle", "kuromon-market", "umeda-sky", "shinsekai", "usj", "nara-deer", "minoo-falls"];
const NARA = ["todai-ji", "nara-park-deer", "kasuga-taisha", "naramachi", "horyu-ji", "mount-wakakusa", "isuien-garden", "mount-yoshino"];
const KYUSHU = ["fukuoka-yatai", "dazaifu-tenmangu", "nagasaki-glover", "kumamoto-castle", "beppu-hells", "yufuin", "sakurajima", "takachiho-gorge"];

export const DESTINATIONS: Destination[] = [
  {
    key: "tokyo",
    label: "Tokyo",
    tagline: "Temples at dawn, neon by night",
    cities: ["Tokyo"],
    cardIds: TOKYO,
    heroCard: "shibuya-crossing",
    brief:
      "The whole trip is in Tokyo and its day trips. One hotel, chosen for the neighbourhoods the group picked. Move by metro and JR; name lines and times.",
  },
  {
    key: "kyoto-osaka",
    label: "Kyoto & Osaka",
    tagline: "Shrines, markets and Dotonbori",
    cities: ["Kyoto", "Osaka"],
    cardIds: [...KYOTO, ...OSAKA],
    heroCard: "fushimi-inari",
    brief:
      "The trip is in Kansai: Kyoto and Osaka are 15 minutes apart by Shinkansen or 30 by JR Special Rapid. Pick ONE base city for the hotel (two at most) and day-trip to the other; Nara and Minoo are day trips from either.",
  },
  {
    key: "nara",
    label: "Nara",
    tagline: "Deer, giant Buddhas and quiet lanes",
    cities: ["Nara"],
    cardIds: NARA,
    heroCard: "todai-ji",
    brief:
      "The whole trip is in Nara prefecture. One hotel in Nara city near Kintetsu-Nara or JR Nara. Horyu-ji and Mount Yoshino are train day trips; say which line. Arrive via Kansai airport and the Kintetsu line from Osaka Namba or the JR line from Kyoto.",
  },
  {
    key: "kyushu",
    label: "Kyushu",
    tagline: "Onsen towns, volcanoes and yatai",
    cities: ["Fukuoka", "Nagasaki", "Kumamoto", "Beppu", "Yufuin", "Kagoshima", "Takachiho"],
    cardIds: KYUSHU,
    heroCard: "beppu-hells",
    brief:
      "The whole trip is in Kyushu. Fly into Fukuoka. Fukuoka is the hub: Nagasaki 1 h 30 by Kamome Shinkansen plus relay, Kumamoto 40 min by Kyushu Shinkansen, Beppu and Yufuin about 2 h by Sonic or Yufuin-no-Mori limited express, Kagoshima 1 h 20 by Shinkansen, Takachiho by bus from Kumamoto. Pick at most two bases (e.g. Fukuoka, then Beppu or Kumamoto) and day-trip from them. Use search_hotels with the base city name.",
  },
  {
    key: "japan",
    label: "Japan grand tour",
    tagline: "Tokyo, Kyoto, Osaka and Kyushu in one go",
    cities: ["Tokyo", "Kyoto", "Osaka", "Fukuoka"],
    cardIds: [...TOKYO, ...KYOTO, ...OSAKA, ...KYUSHU],
    heroCard: "kinkaku-ji",
    brief:
      "The deck spans Tokyo, Kyoto/Osaka and Kyushu (Fukuoka, Dazaifu, Nagasaki, Kumamoto, Beppu, Yufuin, Kagoshima, Takachiho). Kyushu is far: Tokyo to Hakata is about 5 h by Nozomi or a 2 h flight, Shin-Osaka to Hakata about 2 h 30 by Shinkansen. Count the group's picks per region. Include Kyushu when it has three or more picks and the trip is five nights or longer, giving it at least two nights; otherwise leave it out and say so in tradeoffs. Keep at most 2 hotels, or 3 when Kyushu is included.",
  },
  {
    key: "soon",
    label: "More destinations coming",
    tagline: "Seoul, Taipei, Bangkok, Italy",
    cities: [],
    cardIds: [],
    heroCard: "sakurajima",
    brief: "",
    comingSoon: true,
  },
];

export const DEFAULT_DESTINATION = "japan";

export function destination(key: string | null | undefined): Destination {
  return DESTINATIONS.find((d) => d.key === key && !d.comingSoon) ?? DESTINATIONS.find((d) => d.key === DEFAULT_DESTINATION)!;
}

/** Stored in rooms.destination; shown on screens and given to the agent. */
export function destinationLabel(d: Destination) {
  return d.key === "japan" ? "Japan: Tokyo, Kyoto, Osaka & Kyushu" : `Japan: ${d.label}`;
}
