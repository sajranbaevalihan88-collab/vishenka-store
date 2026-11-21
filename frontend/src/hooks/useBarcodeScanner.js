import { useEffect, useRef } from 'react';
import { normalizeScannedCode, isValidEan13 } from '../utils/barcode';

/**
 * Глобальный перехватчик USB / 2.4GHz / Bluetooth сканера штрихкодов (HID Keyboard).
 *
 * Особенности:
 * - Работает при русской и английской раскладках Windows, с Numpad и обычными цифрами.
 * - Работает с Enter/Tab суффиксом И даже если сканер НЕ передаёт Enter (авто-триггер
 *   для валидного EAN-13 или быстрой серии из 8+ цифр после паузы 230мс).
 * - Устойчив к более медленным беспроводным 2.4GHz / Bluetooth сканерам (до 150мс между символами).
 */
export function useBarcodeScanner({ enabled = true, onScan }) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastTime = 0;
    let fastStreak = 0;
    let idleTimer = null;

    const clear = () => {
      buffer = '';
      fastStreak = 0;
      lastTime = 0;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const emit = (raw) => {
      const code = normalizeScannedCode(raw).replace(/[\x00-\x1F\x7F]/g, '').trim();
      clear();
      if (code && code.length >= 4 && onScanRef.current) {
        onScanRef.current(code);
      }
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const target = e.target;
      const tag = target?.tagName;
      const inputType = (target?.type || '').toLowerCase();
      const isTextInput =
        (tag === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(inputType)) ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable;

      // Поля ввода обрабатывают сканирование в своих onChange / onKeyDown
      if (isTextInput) return;

      const now = Date.now();
      const delta = lastTime > 0 ? now - lastTime : 0;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.length >= 4) {
          e.preventDefault();
          e.stopPropagation();
          emit(buffer);
          return;
        }
        clear();
        return;
      }

      // Игнорируем служебные клавиши (Shift, CapsLock, AltGraph и т.п.)
      if (!e.key || e.key.length !== 1) return;

      if (lastTime > 0 && delta > 260) {
        buffer = '';
        fastStreak = 0;
      } else if (lastTime > 0 && delta <= 140) {
        fastStreak += 1;
      }

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

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const clean = normalizeScannedCode(buffer).replace(/[\x00-\x1F\x7F]/g, '').trim();
        // Авто-обработка, даже если сканер настроен без суффикса Enter
        if (
          isValidEan13(clean) ||
          (/^\d{8,20}$/.test(clean) && fastStreak >= 3)
        ) {
          emit(clean);
        } else {
          clear();
        }
      }, 240);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clear();
    };
  }, [enabled]);
}
