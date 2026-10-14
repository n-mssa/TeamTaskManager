import { useState } from 'react'

export default function DurationClock({ hours, minutes, onChange }) {
  const [mode, setMode] = useState('hours')
  const hour = Number(hours || 0)
  const minute = Number(minutes || 0)
  const selected = mode === 'hours' ? hour : minute
  const values = Array.from({ length: 12 }, (_, i) => mode === 'hours' ? i : i * 5)
  const angle = (mode === 'hours' ? hour % 12 : minute / 5) * 30
  function choose(value) {
    onChange(mode === 'hours' ? value : hour, mode === 'minutes' ? value : minute)
  }
  return <div className="duration-clock-picker">
    <p>حدد مدة المهمة من الساعة — ساعات ثم دقائق</p>
    <div className="clock-tabs" role="group" aria-label="اختيار الساعات أو الدقائق">
      <button type="button" aria-pressed={mode === 'hours'} onClick={() => setMode('hours')}>الساعات <b dir="ltr">{String(hour).padStart(2, '0')}</b></button>
      <button type="button" aria-pressed={mode === 'minutes'} onClick={() => setMode('minutes')}>الدقائق <b dir="ltr">{String(minute).padStart(2, '0')}</b></button>
    </div>
    <div className="duration-clock" role="group" aria-label={mode === 'hours' ? 'قرص الساعات' : 'قرص الدقائق'}>
      <div className="clock-hand" aria-hidden="true" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
      <span className="clock-center" aria-hidden="true" />
      {values.map((value, index) => <button key={value} type="button" aria-label={`${value} ${mode === 'hours' ? 'ساعة' : 'دقيقة'}`} aria-pressed={selected === value} style={{left: `${50 + 39 * Math.sin(index * Math.PI / 6)}%`, top: `${50 - 39 * Math.cos(index * Math.PI / 6)}%`}} onClick={() => {choose(value); if(mode === 'hours') setMode('minutes')}}>{value}</button>)}
    </div>
    <div className="clock-adjust"><button type="button" aria-label={mode === 'hours' ? 'تقليل ساعة' : 'تقليل دقيقة'} disabled={selected <= 0} onClick={() => choose(selected - 1)}>−</button><span>{selected} {mode === 'hours' ? 'ساعة' : 'دقيقة'}</span><button type="button" aria-label={mode === 'hours' ? 'إضافة ساعة' : 'إضافة دقيقة'} disabled={selected >= (mode === 'hours' ? 99 : 59)} onClick={() => choose(selected + 1)}>+</button></div>
  </div>
}
