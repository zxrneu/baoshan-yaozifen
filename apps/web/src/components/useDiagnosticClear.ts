/** 诊断清理流程：按单一职责统一确认范围与可播报结果，不访问持久对局历史。 */
import { useState } from 'react';
import { decisionLogger } from '@yaozifen/ai-core/engines/decisionLogger';

export function useDiagnosticClear() {
  const [clearNotice, setClearNotice] = useState('');
  function clearDiagnostics() {
    if (!window.confirm('确定清空当前诊断记录（评估与执行日志）吗？此操作不可撤销，不会删除已保存的对局历史。')) return false;
    decisionLogger.clear();
    setClearNotice('已清空当前诊断记录，已保存的对局历史保留。');
    return true;
  }
  return { clearDiagnostics, clearNotice };
}
