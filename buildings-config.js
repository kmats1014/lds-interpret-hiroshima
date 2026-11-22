/**
 * 広島ステーク・関連エリア 教会（建物）・部屋 定義モジュール
 * ホスト側 (app.js) と参加者側 (viewer.html) の両方で共通利用し、
 * 固定ルームID (hiroshima-{buildingId}-{roomId}) による混線防止と常設QRコード運用を実現します。
 */

const STANDARD_ROOMS = [
  { id: 'chapel', nameJa: '礼拝堂', nameEn: 'Chapel' },
  { id: 'rs', nameJa: '扶助協会室', nameEn: 'Relief Society Room' },
  { id: 'primary', nameJa: 'プライマリー室', nameEn: 'Primary Room' },
  { id: 'classroom', nameJa: '教室・その他', nameEn: 'Classroom' },
];

export const HIROSHIMA_BUILDINGS = [
  {
    id: 'hikari',
    nameJa: '広島光',
    nameEn: 'Hiroshima Hikari',
    rooms: STANDARD_ROOMS,
  },
  {
    id: 'takasu',
    nameJa: '高須',
    nameEn: 'Takasu',
    rooms: STANDARD_ROOMS,
  },
  {
    id: 'hatsukaichi',
    nameJa: '廿日市',
    nameEn: 'Hatsukaichi',
    rooms: STANDARD_ROOMS,
  },
  {
    id: 'yanai',
    nameJa: '柳井',
    nameEn: 'Yanai',
    rooms: STANDARD_ROOMS,
  },
  {
    id: 'tokuyama',
    nameJa: '徳山',
    nameEn: 'Tokuyama',
    rooms: STANDARD_ROOMS,
  },
  {
    id: 'saijo',
    nameJa: '西条',
    nameEn: '西条 / Saijo'.replace('西条 / ', ''),
    rooms: STANDARD_ROOMS,
  },
  {
    id: 'hamada',
    nameJa: '浜田',
    nameEn: 'Hamada',
    rooms: STANDARD_ROOMS,
  },
];

export function buildHiroshimaRoomId(buildingId, roomId) {
  const b = (buildingId || 'hikari').replace(/[^a-zA-Z0-9_-]/g, '');
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
