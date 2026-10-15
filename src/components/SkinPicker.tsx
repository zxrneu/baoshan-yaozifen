/** 皮肤选择仅维护视图状态，模态键盘与方向适配复用公共容器。 */
import { useState } from 'react';
import { SKINS, type SkinId } from '../themes';
import styles from './SkinPicker.module.css';
import Modal from './Modal';

export default function SkinPicker({ skin, onChange }: { skin: SkinId; onChange: (skin: SkinId) => void }) {
  const [open, setOpen] = useState(false);
  const current = SKINS.find((item) => item.id === skin)!;

  const close = () => setOpen(false);

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={styles.swatch} aria-hidden="true" />
        换皮肤 <span className={styles.current}>{current.name}</span>
      </button>
      {open && <Modal
        label="皮肤选择"
        className={`modal-box ${styles.dialog}`}
        onClose={close}
      >
          <div className={`modal-header ${styles.header}`}>
            <div>
              <h2 id="skin-picker-title">换个牌桌，换种心情</h2>
              <p>即时预览，自动记住你的选择</p>
            </div>
            <button type="button" className={styles.close} onClick={close} aria-label="关闭皮肤选择">×</button>
          </div>
          <div className="modal-body"><div className={styles.options}>
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
          </div></div>
          <div className="modal-footer"><button type="button" className="primary-btn" onClick={close}>就用这款</button></div>
      </Modal>}
    </>
  );
}
