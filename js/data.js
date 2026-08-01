// D:\Laporan Online\dashboard-keuangan\js\data.js
import { supabase } from './auth.js';

export async function fetchOutlets() {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, brand')
    .eq('aktif', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchDailyReportsForMonth(year, month) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDayNum = new Date(year, month, 0).getDate();
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('daily_reports')
    .select('outlet_id, report_date, omzet, omzet_tunai, omzet_online')
    .gte('report_date', firstDay)
    .lte('report_date', lastDay);
  if (error) throw error;
  // Coerce omzet defensively: Postgres `numeric` can serialize as a string,
  // and a string would silently turn every downstream sum into concatenation.
  // omzet_tunai / omzet_online stay null when not yet backfilled — the split
  // aggregator distinguishes null (no data) from 0.
  return data.map((r) => ({
    ...r,
    omzet: Number(r.omzet) || 0,
    omzet_tunai: r.omzet_tunai == null ? null : Number(r.omzet_tunai),
    omzet_online: r.omzet_online == null ? null : Number(r.omzet_online),
  }));
}

// Freshness marker: the most recent write across all reports. The pusher
// runs twice daily (23:00 & 07:30 WIB), so this tells the owner how stale
// the numbers on screen are.
export async function fetchLastUpdated() {
  const { data, error } = await supabase
    .from('daily_reports')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data.length ? data[0].updated_at : null;
}

export async function fetchRankingForDate(dateStr) {
  const { data, error } = await supabase
    .from('v_ranking_harian')
    .select('outlet_id, outlet_name, brand, omzet, peringkat')
    .eq('report_date', dateStr)
    .order('peringkat', { ascending: true });
  if (error) throw error;
  return data.map((r) => ({ ...r, omzet: Number(r.omzet) || 0 }));
}
