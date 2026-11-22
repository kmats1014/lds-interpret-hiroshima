/**
 * 広島県内 教会（建物）・部屋 定義モジュール
 * ホスト側 (app.js) と参加者側 (viewer.html) の両方で共通利用し、
 * 固定ルームID (hiroshima-{buildingId}-{roomId}) による混線防止と常設QRコード運用を実現します。
 */

export const HIROSHIMA_BUILDINGS = [
  {
    id: 'hakushima',
    nameJa: '広島（白島）',
    nameEn: 'Hiroshima (Hakushima)',
    rooms: [
      { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
      { id: 'rs', nameJa: '扶助協会室', nameEn: 'Relief Society Room' },
      { id: 'primary', nameJa: 'プライマリー室', nameEn: 'Primary Room' },
      { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
    ],
  },
  {
    id: 'fukuyama',
    nameJa: '福山',
    nameEn: 'Fukuyama',
    rooms: [
      { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
      { id: 'rs', nameJa: '扶助協会室', nameEn: 'Relief Society Room' },
      { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
    ],
  },
  {
    id: 'kure',
    nameJa: '呉',
    nameEn: 'Kure',
    rooms: [
      { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
      { id: 'rs', nameJa: '扶助協会室', nameEn: 'Relief Society Room' },
      { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
    ],
  },
  {
    id: 'higashihiroshima',
    nameJa: '東広島',
    nameEn: 'Higashihiroshima',
    rooms: [
      { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
      { id: 'rs', nameJa: '扶助協会室', nameEn: 'Relief Society Room' },
      { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
    ],
  },
  {
    id: 'onomichi',
    nameJa: '尾道',
    nameEn: 'Onomichi',
    rooms: [
      { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
      { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
    ],
  },
  {
    id: 'miyoshi',
    nameJa: '三次',
    nameEn: 'Miyoshi',
    rooms: [
      { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
      { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
    ],
  },
];

export function buildHiroshimaRoomId(buildingId, roomId) {
  const b = (buildingId || 'hakushima').replace(/[^a-zA-Z0-9_-]/g, '');
  const r = (roomId || 'chapel').replace(/[^a-zA-Z0-9_-]/g, '');
  return `hiroshima-${b}-${r}`;
}

export function findBuildingAndRoom(fullRoomId) {
  if (!fullRoomId || typeof fullRoomId !== 'string') return null;
  for (const building of HIROSHIMA_BUILDINGS) {
    for (const room of building.rooms) {
      if (buildHiroshimaRoomId(building.id, room.id) === fullRoomId) {
        return { building, room };
      }
    }
  }
  return null;
}

export function getAllHiroshimaRoomIds() {
  const list = [];
  for (const building of HIROSHIMA_BUILDINGS) {
    for (const room of building.rooms) {
      list.push({
        fullRoomId: buildHiroshimaRoomId(building.id, room.id),
        building,
        room,
      });
    }
  }
  return list;
}
