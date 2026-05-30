import './style.css';
import { gsap } from 'gsap';

// ==========================================================================
// 1. Dynamic Fluted Glass Ribbon Generation
// ==========================================================================

const initFlutedGlass = () => {
  const container = document.getElementById('flutes-container');
  if (!container) return;

  const numFlutes = 70; // High-precision vertical bars for gorgeous dense glass texture
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < numFlutes; i++) {
    const flute = document.createElement('div');
    flute.classList.add('flut');
    fragment.appendChild(flute);
  }

  container.appendChild(fragment);

  // Looping undulating wave animation using GSAP stagger
  gsap.fromTo('.flut',
    {
      scaleY: 0.92,
      opacity: 0.75,
      translateY: '-2%'
    },
    {
      scaleY: 1.15,
      opacity: 0.95,
      translateY: '2%',
      duration: 3,
      stagger: {
        each: 0.05,
        repeat: -1,
        yoyo: true
      },
      ease: 'sine.inOut',
      force3D: true
    }
  );
};

// ==========================================================================
// 2. Interactive Mouse Follower Ripple (Warping Glass)
// ==========================================================================

const initGlassInteraction = () => {
  const hero = document.querySelector('.hero-section');
  if (!hero) return;

  hero.addEventListener('mousemove', (e: Event) => {
    const mouseEvent = e as MouseEvent;
    const rect = hero.getBoundingClientRect();
    const x = mouseEvent.clientX - rect.left; // Mouse X relative to container
    const width = rect.width;
    const ratio = x / width; // X ratio (0 to 1)

    const flutes = document.querySelectorAll('.flut');
    const totalFlutes = flutes.length;
    const activeIndex = Math.floor(ratio * totalFlutes);

    // Apply interactive bulge/ripple centered at active index
    flutes.forEach((flute, idx) => {
      const distance = Math.abs(idx - activeIndex);

      if (distance < 8) {
        // High proximity bulges
        const factor = (8 - distance) / 8; // 1 at center, 0 at edge of ripple
        gsap.to(flute, {
          scaleY: 1.15 + factor * 0.22,
          opacity: 0.9 + factor * 0.1,
          translateY: `${factor * 4}%`,
          duration: 0.4,
          overwrite: 'auto',
          ease: 'power2.out'
        });
      } else {
        // Return to normal stagger baseline
        gsap.to(flute, {
          scaleY: 1,
          translateY: '0%',
          duration: 0.8,
          overwrite: 'auto',
          ease: 'power2.out'
        });
      }
    });
  });

  // Return to normal on mouse leave
  hero.addEventListener('mouseleave', () => {
    const flutes = document.querySelectorAll('.flut');
    flutes.forEach((flute) => {
      gsap.to(flute, {
        scaleY: 1,
        translateY: '0%',
        duration: 1,
        overwrite: 'auto',
        ease: 'power2.out'
      });
    });
  });
};

const initThemeSelector = () => {
  const themeBtns = document.querySelectorAll('.theme-btn');

  const shiftColors = (theme: string) => {
    const config: Record<string, { silver: number, indigo: number, blue: number, aurora: number }> = {
      silver: { silver: 0.7, indigo: 0.1, blue: 0.1, aurora: 0 },
      aurora: { silver: 0.1, indigo: 0.1, blue: 0.3, aurora: 0.65 },
      indigo: { silver: 0.05, indigo: 0.7, blue: 0.25, aurora: 0 }
    };

    const target = config[theme];
    if (!target) return;

    gsap.to('.grad-silver', { opacity: target.silver, scale: theme === 'silver' ? 1.3 : 1, duration: 1.5, ease: 'power2.out' });
    gsap.to('.grad-indigo', { opacity: target.indigo, scale: theme === 'indigo' ? 1.3 : 1, duration: 1.5, ease: 'power2.out' });
    gsap.to('.grad-blue', { opacity: target.blue, scale: theme === 'aurora' || theme === 'indigo' ? 1.2 : 0.9, duration: 1.5, ease: 'power2.out' });
    gsap.to('.grad-aurora', { opacity: target.aurora, scale: theme === 'aurora' ? 1.35 : 0.9, duration: 1.5, ease: 'power2.out' });

    const nav = document.getElementById('navbar');
    if (nav) {
      const borderGlow = {
        silver: 'rgba(255, 255, 255, 0.09)',
        aurora: 'rgba(6, 182, 212, 0.15)',
        indigo: 'rgba(99, 102, 241, 0.15)'
      }[theme];
      gsap.to(nav, { borderColor: borderGlow, duration: 1 });
    }
  };

  themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.getAttribute('data-theme') || 'silver';
      shiftColors(theme);
    });
  });
};
// ==========================================================================
// 4. Interactive System Architecture Blueprint
// ==========================================================================

const initArchitectureDetails = () => {
  const blocks = document.querySelectorAll('.arch-block');
  const indicators = document.querySelectorAll('.indicator-item');
  const title = document.getElementById('arch-detail-title');
  const desc = document.getElementById('arch-detail-desc');

  const archContent: Record<string, { title: string, desc: string }> = {
    ui: {
      title: '1. 极简桌面壳层 (Shell Layer)',
      desc: '使用 Electron 跑容器，React 绘制 Workbench 工作台。前台不包含任何核心业务逻辑，完全是“数据驱动的状态机投影”。所有看到的聊天 Bubble、Timeline 和 Todo 面板，全部只读消费后台的 `timeline_projection` JSON 报文，坚决不参与任何持久化层修改，从源头杜绝状态错乱。'
    },
    daemon: {
      title: '2. 安全守护进程 (Process Boundary)',
      desc: '`lyrad` 是系统的进程与 RPC 路由边界。所有 UI 操作转化为统一的命令 DTO 输送进后台，所有的后台 SQLite 记忆更新转化为 typed `AgentRuntimeEvent` 瞬时向前端广播。同时负责管理后台进程生命周期、热重载（Reload）的自动捕获与连接重试。'
    },
    runtime: {
      title: '3. 强状态运行时 (Runtime Layer)',
      desc: '`crates/lyra-agent-runtime` 充当主控制中心。它控制会话 Session 的生命周期，并通过 Context Assembler 实现高度工程化的上下文打包：依据模型上下文硬预算（Hard Token Budget）动态调配，在物理 Trim 裁剪写入归档（Cuts Pack）前强制锁死 Commit，并在重启后自动组装 typed recovery context，模型再也不可能生成乱码提示。'
    },
    kernel: {
      title: '4. 极客引擎内核 (Agent Kernel)',
      desc: '`crates/lyra-agent-kernel` 提供最纯粹的 Agent Primitives。维护模型的调用循环（Streaming Prompt Loop）、工具链（Tool Pack）的定义与反射执行。它是一个高度内聚、不依赖任何上层 GUI/Desktop 图标或路由结构的纯 Rust 计算核心，完全支持在命令行终端（lyra-cli）进行纯文本式会话演练。'
    }
  };

  const updateArchDetail = (archKey: string) => {
    const data = archContent[archKey];
    if (!data || !title || !desc) return;

    // Remove active state
    blocks.forEach(b => b.classList.remove('active'));
    indicators.forEach(i => i.classList.remove('active'));

    // Set active state
    const block = document.querySelector(`.arch-block[data-arch="${archKey}"]`);
    const indicator = document.querySelector(`.indicator-item[data-target="${archKey}"]`);
    if (block) block.classList.add('active');
    if (indicator) indicator.classList.add('active');

    // Smooth text transition using GSAP
    gsap.fromTo([title, desc],
      { opacity: 0, y: 10 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.08,
        overwrite: 'auto',
        ease: 'power2.out'
      }
    );

    title.innerText = data.title;
    desc.innerText = data.desc;
  };

  blocks.forEach((block) => {
    block.addEventListener('click', () => {
      const arch = block.getAttribute('data-arch') || 'ui';
      updateArchDetail(arch);
    });
  });

  indicators.forEach((ind) => {
    ind.addEventListener('click', () => {
      const target = ind.getAttribute('data-target') || 'ui';
      updateArchDetail(target);
    });
  });
};

// ==========================================================================
// 5. Interactive Security Sandbox Simulator
// ==========================================================================

const initSecuritySimulator = () => {
  const triggerBtns = document.querySelectorAll('.sim-trigger-btn');
  const dialog = document.getElementById('consent-dialog');
  const badge = document.getElementById('sim-badge');
  const title = document.getElementById('sim-dialog-title');
  const desc = document.getElementById('sim-dialog-desc');
  const code = document.getElementById('sim-dialog-code');
  const terminal = document.getElementById('sim-terminal-body');

  const allowBtn = document.getElementById('sim-btn-allow');
  const denyBtn = document.getElementById('sim-btn-deny');

  const simContent: Record<string, { badge: string, title: string, desc: string, code: string, warning: string, textStyle: string }> = {
    file_edit: {
      badge: 'FILE ACCESS',
      title: '检测到高风险 AI 文件修改申请',
      desc: 'Agent 正在申请修改您本地的工作空间敏感目录。该行为具有潜在的文件覆盖风险，需确认沙箱权限授权。',
      code: `Target: /etc/hosts\nAction: write_file\nLine addition: + "127.0.0.1 sandbox.lyra-agent-dev.local"`,
      warning: '重要提醒：此行为由 Agent 触发。授权后操作将由 Rust runtime 物理执行。',
      textStyle: 'text-yellow'
    },
    command_run: {
      badge: 'TERMINAL EXECUTION',
      title: '检测到本地 Shell 命令执行请求',
      desc: 'Agent 尝试在您当前的 workspace 沙箱进程中执行本地命令。由于存在系统级写入风险，操作已被安全隔离挂起。',
      code: `Shell: zsh\nCommand: rm -rf ./node_modules && pnpm install\nRisk Level: HIGH`,
      warning: '警告：随意授权任意命令可能导致本地数据丢失。请仔细核实命令意图后再允许。',
      textStyle: 'text-red'
    },
    network_fetch: {
      badge: 'NETWORK ACCESS',
      title: '检测到未授信域外网络连接申请',
      desc: 'Agent 正尝试使用本地 TCP 端口连接受保护沙箱外的外部节点，发起 HTTP REST 请求拉取配置。',
      code: `Target URL: http://api.external-track.com/v1/metrics\nMethod: POST\nPayload: { "workbench_id": "lyra_local_3146" }`,
      warning: '注意：外网访问可能泄露您当前的本地网络地址配置。',
      textStyle: 'text-blue'
    }
  };

  let activeAction = 'file_edit';
  let isPending = true;

  const appendTerminalLog = (text: string, colorClass = 'text-dim') => {
    if (!terminal) return;
    const log = document.createElement('p');
    log.classList.add('terminal-line', colorClass);

    const timestamp = new Date().toISOString();
    log.innerText = `[${timestamp}] ${text}`;
    terminal.appendChild(log);

    // Auto scroll to bottom
    gsap.to(terminal, {
      scrollTop: terminal.scrollHeight,
      duration: 0.3
    });
  };

  const updateSimulatorState = (action: string) => {
    const data = simContent[action];
    if (!data || !badge || !title || !desc || !code || !dialog) return;

    activeAction = action;
    isPending = true;

    // Reset active buttons
    triggerBtns.forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.sim-trigger-btn[data-action="${action}"]`);
    if (btn) btn.classList.add('active');

    // Smooth dialog popup animation
    gsap.fromTo(dialog,
      { scale: 0.95, opacity: 0.8 },
      { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.2)' }
    );

    // Update text
    badge.innerText = data.badge;
    title.innerText = data.title;
    desc.innerText = data.desc;
    code.innerText = data.code;

    // Update badge color class
    badge.className = 'dialog-badge';
    if (action === 'file_edit') badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
    if (action === 'command_run') badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    if (action === 'network_fetch') badge.style.borderColor = 'rgba(59, 130, 246, 0.3)';

    // Print to Audit Terminal
    appendTerminalLog(`[AWAITING_USER] Sandbox intercepted \`${action}\` request. Dialog prompted.`, data.textStyle);
  };

  triggerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action') || 'file_edit';
      updateSimulatorState(action);
    });
  });

  // Handle Dialog Actions (Allow / Deny)
  if (allowBtn && dialog) {
    allowBtn.addEventListener('click', () => {
      if (!isPending) return;
      isPending = false;

      // Click response animation
      gsap.to(dialog, {
        scale: 0.98,
        opacity: 0.5,
        duration: 0.2,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          appendTerminalLog(`[AUTHORIZED] User approved \`${activeAction}\` request. Operating natively.`, 'text-green');
          appendTerminalLog(`[SUCCESS] sandbox operation executed with exit code 0.`, 'text-green');
        }
      });
    });
  }

  if (denyBtn && dialog) {
    denyBtn.addEventListener('click', () => {
      if (!isPending) return;
      isPending = false;

      // Shake animation for rejection
      gsap.timeline()
        .to(dialog, { x: -8, duration: 0.08 })
        .to(dialog, { x: 8, duration: 0.08 })
        .to(dialog, { x: -4, duration: 0.08 })
        .to(dialog, { x: 4, duration: 0.08 })
        .to(dialog, { x: 0, duration: 0.08 })
        .to(dialog, { opacity: 0.7, duration: 0.2 })
        .call(() => {
          appendTerminalLog(`[SECURITY WARNING] User REJECTED \`${activeAction}\` request.`, 'text-red');
          appendTerminalLog(`[BLOCKED] Operation denied. Process execution aborted by sandbox.`, 'text-red');
        });
    });
  }
};

// ==========================================================================
// 6. Header Scrolled state management
// ==========================================================================

const initHeaderScroll = () => {
  const header = document.getElementById('navbar');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
};

// ==========================================================================
// Init Main Lifecycle
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initFlutedGlass();
  initGlassInteraction();
  initThemeSelector();
  initArchitectureDetails();
  initSecuritySimulator();
  initHeaderScroll();
});
