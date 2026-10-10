import { useEffect, useRef, useState } from 'react';
import { SKINS, type SkinId } from '../themes';
import styles from './SkinPicker.module.css';

export default function SkinPicker({ skin, onChange }: { skin: SkinId; onChange: (skin: SkinId) => void }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = SKINS.find((item) => item.id === skin)!;

  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [open]);

  const close = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={styles.swatch} aria-hidden="true" />
        换皮肤 <span className={styles.current}>{current.name}</span>
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="skin-picker-title"
        onClose={() => setOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <div className={styles.content}>
          <div className={styles.header}>
            <div>
              <h2 id="skin-picker-title">换个牌桌，换种心情</h2>
              <p>即时预览，自动记住你的选择</p>
            </div>
            <button type="button" className={styles.close} onClick={close} aria-label="关闭皮肤选择">×</button>
          </div>
          <div className={styles.options}>
            {SKINS.map((item) => (
              <button
                type="button"
                key={item.id}
                data-skin={item.id}
                className={styles.option}
                aria-pressed={skin === item.id}
                onClick={() => onChange(item.id)}
              >
                <span className={styles.preview} aria-hidden="true">
                  <span className={styles.previewMark}>{item.mark}</span>
                  <span className={styles.previewCards}><i>A<span>♥</span></i><i>K<span>♠</span></i><i>5<span>♣</span></i></span>
                </span>
                <span className={styles.optionName}>{item.name}<span className={styles.check}>{skin === item.id ? '✓' : ''}</span></span>
                <span className={styles.description}>{item.description}</span>
              </button>
            ))}
          </div>
          <button type="button" className={`primary-btn ${styles.done}`} onClick={close}>就用这款</button>
        </div>
      </dialog>
    </>
  );
}
