/** A row of mutually exclusive options (radio buttons styled as one control). */
export function Segmented<T extends string | number>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <label key={String(option.value)} className="seg-item">
          <input
            type="radio"
            name={name}
            value={String(option.value)}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
