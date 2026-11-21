import React, { useMemo } from 'react';
import { buildBarcodeSvg } from '../utils/barcode';

export default function BarcodeSvg({ value, barHeight = 46, showText = true, fontSize = 11, className = '' }) {
  const markup = useMemo(
    () => buildBarcodeSvg(value, { barHeight, showText, fontSize }),
    [value, barHeight, showText, fontSize]
  );

  if (!markup) return null;
  return (
    <div
      className={'barcode-svg-wrap ' + className}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
