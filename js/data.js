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
    .select('outlet_id, report_date, omzet')
    .gte('report_date', firstDay)
    .lte('report_date', lastDay);
  if (error) throw error;
  return data;
}

export async function fetchRankingForDate(dateStr) {
  const { data, error } = await supabase
    .from('v_ranking_harian')
    .select('outlet_id, outlet_name, brand, omzet, peringkat')
    .eq('report_date', dateStr)
    .order('peringkat', { ascending: true });
  if (error) throw error;
  return data;
}
