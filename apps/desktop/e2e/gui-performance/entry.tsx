import React, {useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {useWindowResizeClass} from '../../src/modules/workbench/shell/use-window-resize-class';
import {createRoot} from 'react-dom/client';
import {ChatView} from '../../src/modules/workbench/ai-panel/lyra-agents/features/chat/ChatView';
import {DataContextProvider} from '../../src/modules/workbench/ai-panel/lyra-agents/data/DataProvider';
import {createDataProviderValue} from '../../src/modules/workbench/ai-panel/lyra-agents/data/createDataProviderValue';
import {getStreamStore, resetStreamStore} from '../../src/modules/workbench/agent-session-view-model/stream-store';
import {usePanelLayoutModel} from '../../src/modules/workbench/shell/use-panel-layout';
import {WorkbenchI18nProvider} from '../../src/modules/workbench/i18n';
import {resolveThemeVars} from '../../src/modules/workbench/theme';
import {syncDocumentThemeTone} from '../../src/modules/workbench/shell/service';
import type {ComposerInsertableCitation} from '../../src/modules/workbench/ai-panel/lyra-agents/features/chat/message-citation';
import type {CitationScrollTarget} from '../../src/modules/workbench/ai-panel/lyra-agents/data/DataProvider';
import '../../src/renderer/styles/index.scss';
import './fixture.css';

const cache = new Map<string,string>();
(window as any).lyraDesktop = {workbenchState:{readCached:(key:string)=>cache.get(key)??null,write:async(key:string,value:string)=>{cache.set(key,value)},remove:async(key:string)=>{cache.delete(key)}}};
const setTheme = (tone: 'light' | 'dark') => {
  const theme = tone === 'dark' ? 'lyra-dark' : 'lyra-light';
  syncDocumentThemeTone(theme);
  for(const [name,value] of Object.entries(resolveThemeVars(theme,false)))document.documentElement.style.setProperty(name,value);
};
setTheme('light');
// Synthetic data only: never opens a provider, user session or user workspace.
const prose = '这里是一段用于重现聊天排版负载的固定中文材料。拖动左右面板之间的分隔线时，文字需要随着可用宽度重新换行，用户应当能够继续阅读并保持当前位置。This paragraph describes the same repeatable resize action with mixed Chinese and English text.';
const session={id:'audit',title:'UI diagnostic',project:'',workingDir:'',projectBound:false,workingDirIsHome:false,totalAdditions:0,totalDeletions:0};
const richDocument = '### 表格\n\n| 模块 | 状态 | 负责人 | 完成度 |\n| :--- | :---: | :--- | ---: |\n| 前端 | ✅ | Alice | 92% |\n| 后端 | 🔧 | Bob | 78% |\n| 测试 | ⏳ | Carol | 45% |\n\n### 代码\n\n```typescript\ninterface User {\n  id: number;\n  name: string;\n}\n\nexport async function fetchUser(id: number) {\n  return { id, name: "example" };\n}\n```';
function Fixture(){
  useWindowResizeClass();
  const source=useRef('');
  const root=useRef<HTMLDivElement>(null);
  const layout=usePanelLayoutModel(root);
  const [scenario,setScenario]=useState({count:0,kind:'paragraphs',streaming:false,revision:0});
  const [messages,setMessages]=useState<any[]>([]);
  const [pendingCitation, setPendingCitation] = useState<ComposerInsertableCitation | null>(null);
  const [pendingCitationNonce, setPendingCitationNonce] = useState(0);
  const [citationScrollTarget, setCitationScrollTarget] = useState<CitationScrollTarget | null>(null);
  const data=createDataProviderValue({session:{...session,id:`audit-${scenario.revision}`},messages,isTurnRunning:scenario.streaming,followActivity:scenario.streaming?'streaming_model':null,
    pendingCitation, pendingCitationNonce, citationScrollTarget,
    addCitationToComposer: citation => {setPendingCitation({kind:'transcript', citation});setPendingCitationNonce(nonce => nonce + 1)},
    scrollToMessage: async (messageId, options) => setCitationScrollTarget({messageId,...options,token:Date.now()})
  });
  (window as any).audit={
    scenario:(count:number,kind='paragraphs',streaming=false)=>{
      resetStreamStore();
      setPendingCitation(null);setPendingCitationNonce(0);setCitationScrollTarget(null);
      const body=kind==='empty'?'':kind==='rich'?richDocument:kind==='single'?prose.repeat(45):kind==='code'?'```typescript\n'+Array.from({length:180},(_,i)=>`const item${i} = { label: "sample", index: ${i} };`).join('\n'):Array.from({length:10},(_,i)=>`### 段落 ${i+1}\n\n${prose}\n\n`).join('');
      source.current=body;
      setScenario(current=>({count,kind,streaming,revision:current.revision+1}));
      setMessages(Array.from({length:count},(_,i)=>({id:`message-${i}`,author:'agent',blocks:[{type:'text',id:`block-${i}`,body}]})));
    },
    append:(delta:string)=>{source.current+=delta;getStreamStore().appendDelta(`message-${scenario.count-1}`,`block-${scenario.count-1}`,delta)},
    replace:(text:string)=>{source.current=text;getStreamStore().appendDelta(`message-${scenario.count-1}`,`block-${scenario.count-1}`,text,true)},
    reasoningSnapshot:(body:string)=>{
      resetStreamStore();
      setScenario(current=>({count:1,kind:'reasoning',streaming:true,revision:current.revision+1}));
      setMessages([{id:'reasoning-message',author:'agent',blocks:[
        {type:'thinking',id:'reasoning-block',body,status:'running'},
        {type:'text',id:'reasoning-text',body:''}
      ]}]);
    },
    appendReasoning:(delta:string)=>getStreamStore().appendReasoningDelta('reasoning-message',delta),
    finish:()=>{
      flushSync(()=>{getStreamStore().reset(`message-${scenario.count-1}`);setScenario({...scenario,streaming:false});setMessages(current=>current.map((message,index)=>index===scenario.count-1?{...message,blocks:[{...message.blocks[0],body:source.current}]}:message))});
    },
    source:()=>source.current,
    theme:setTheme,
    citation:()=>pendingCitation?.citation,
    citationTarget:()=>citationScrollTarget,
    prose,
  };
  return <div className="lyra-root audit-root" ref={root} style={layout.cssVars as React.CSSProperties}>
    <div className="audit-label">Diagnostic fixture · production ChatView, StreamingText, split handler and styles · synthetic messages</div>
    <div className="audit-grid">
      <div className="audit-chat lyra-agents-host"><div className="lyra-agents-app"><DataContextProvider value={data}><ChatView showDecisions={false} showPermission={false}/></DataContextProvider></div></div>
      <div className="lyra-resizer audit-sash" onMouseDown={layout.onLeftResizeMouseDown} role="separator"/>
      <div className="audit-workspace">工作区（本次实验不加载浏览器、编辑器或终端）</div>
    </div>
  </div>;
}
createRoot(document.getElementById('app')!).render(<WorkbenchI18nProvider><Fixture/></WorkbenchI18nProvider>);
