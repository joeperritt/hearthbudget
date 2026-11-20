import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { readSnapshot, writeSnapshot } from '@/lib/snapshot';
import { Sun, Cloud, CloudSun, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudDrizzle } from 'lucide-react';

// Lexington, SC
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=33.9815&longitude=-81.2362&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1';

function describe(code: number): { label: string; Icon: typeof Sun } {
  if (code === 0) return { label: 'Clear', Icon: Sun };
  if (code <= 2) return { label: 'Partly cloudy', Icon: CloudSun };
  if (code === 3) return { label: 'Cloudy', Icon: Cloud };
  if (code <= 48) return { label: 'Fog', Icon: CloudFog };
  if (code <= 57) return { label: 'Drizzle', Icon: CloudDrizzle };
  if (code <= 67 || (code >= 80 && code <= 82)) return { label: 'Rain', Icon: CloudRain };
  if (code <= 77 || code === 85 || code === 86) return { label: 'Snow', Icon: CloudSnow };
  return { label: 'Storms', Icon: CloudLightning };
}

export function WeatherStrip() {
  const { user } = useAuth();
  type W = { temp: number; code: number; hi: number; lo: number };
  const [w, setW] = useState<W | null>(() => {
    const s = readSnapshot<W>(user?.id, 'weather');
    return s && [s.temp, s.code, s.hi, s.lo].every(n => typeof n === 'number') ? s : null;
  });
  useEffect(() => {
    let alive = true;
    const load = () => fetch(URL).then(r => r.json()).then(d => {
      if (!alive) return;
      const next = { temp: d.current.temperature_2m, code: d.current.weather_code, hi: d.daily.temperature_2m_max[0], lo: d.daily.temperature_2m_min[0] };
      setW(next);
      writeSnapshot(user?.id, 'weather', next);
    }).catch(() => {});
    load();
    const t = setInterval(load, 15 * 60 * 1000);
    window.addEventListener('perritt-resume', load);
    return () => { alive = false; clearInterval(t); window.removeEventListener('perritt-resume', load); };
  }, [user?.id]);

  if (!w) return <div className="text-xs text-muted-foreground">Lexington, SC</div>;
  const { label, Icon } = describe(w.code);
  return (
    <div title={`Lexington, SC · ${label}`} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <Icon size={16} className="text-accent shrink-0" aria-label={label} />
      <span className="font-semibold text-foreground">{Math.round(w.temp)}°</span>
      <span className="hidden sm:inline">{label}</span>
      <span>H {Math.round(w.hi)}° L {Math.round(w.lo)}°</span>
    </div>
  );
}
