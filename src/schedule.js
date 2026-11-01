// 한국 시간 기준으로 "지금 보내야 하는가"를 판단한다.
// Cron은 5분마다 돌고, 설정 시각부터 60분 안에 한 번만 보낸다.

export const CATCH_UP_WINDOW_MINUTES = 60;
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function nowInZone(offsetMinutes, date = new Date()) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return {
    dateStr: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function shouldSend(settings, state, now) {
  if (settings.paused) return false;
  if (settings.weekdaysOnly && isWeekend(now.weekday)) return false;
  if (state.lastSentDate === now.dateStr) return false;
  const target = timeToMinutes(settings.time);
  return now.minutes >= target && now.minutes < target + CATCH_UP_WINDOW_MINUTES;
}

// "2026-11-01" → "2026년 11월 01일 (일)"
export function formatDateLabel(dateStr, weekday) {
  const [year, month, day] = dateStr.split('-');
  return `${year}년 ${month}월 ${day}일 (${WEEKDAY_NAMES[weekday]})`;
}

function isWeekend(weekday) {
  return weekday === 0 || weekday === 6;
}