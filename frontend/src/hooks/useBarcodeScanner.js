import { useEffect, useRef } from 'react';
import { normalizeScannedCode } from '../utils/barcode';

/**
 * Глобальный перехватчик USB / 2.4GHz беспроводного сканера штрихкодов (HID Keyboard).
 *
 * Как работает:
 * - Аппаратный сканер передаёт символы серией быстрее ~65мс между клавишами и завершает Enter/Tab.
 * - Поддерживает русскую и английскую раскладки Windows автоматически.
 * - Когда курсор НЕ в поле ввода — перехватывает штрихкод в любой точке админки.
 * - Когда курсор в обычном input/textarea — НЕ мешает ручному вводу, но если символы
 *   прилетают со скоростью сканера в специальном поле [data-scanner-input="true"],
 *   перехватывает и обрабатывает мгновенно.
 */
export function useBarcodeScanner({ enabled = true, onScan }) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastTime = 0;
    let fastStreak = 0;
    let resetTimer = null;

    const clear = () => {
      buffer = '';
      fastStreak = 0;
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const target = e.target;
      const tag = target?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      const isScannerField = target?.dataset?.scannerInput === 'true';

      // Если пользователь печатает в обычном текстовом поле (например, название товара или пароль),
      // не мешаем ручному вводу. Поля с data-scanner-input обрабатываются отдельно в своём onKeyDown.
      if (isInput && !isScannerField) return;
      if (isScannerField) return; // Поле сканера само ловит Enter

      const now = Date.now();
      const delta = now - lastTime;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.length >= 4 && (fastStreak >= 2 || delta < 120)) {
          e.preventDefault();
          e.stopPropagation();
          const code = normalizeScannedCode(buffer);
          clear();
          if (code && onScanRef.current) onScanRef.current(code);
          return;
        }
        clear();
        return;
      }

      if (e.key.length === 1) {
        if (lastTime > 0 && delta > 140) {
          buffer = '';
          fastStreak = 0;
        } else if (lastTime > 0 && delta <= 75) {
          fastStreak += 1;
        }

        // Читаем физическую клавишу, если возможно, или нормализуем символ
        let ch = e.key;
        if (/^Digit\d$/.test(e.code) && !e.shiftKey) {
          ch = e.code.slice(5);
        } else if (/^Numpad\d$/.test(e.code)) {
          ch = e.code.slice(6);
        } else if (/^Key[A-Z]$/.test(e.code)) {
          const letter = e.code.slice(3);
          ch = e.shiftKey ? letter : letter.toLowerCase();
        } else if (e.code === 'Minus' && !e.shiftKey) {
          ch = '-';
        }

        buffer += ch;
        lastTime = now;

        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(clear, 350);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clear();
    };
  }, [enabled]);
}
