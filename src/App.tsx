import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeft, Award, BarChart3, Bell, BookOpen, Bot, BrainCircuit, Check,
  ChevronLeft, CirclePlay, Clock3, Code2, Compass, Flame,
  Gauge, LayoutDashboard, LockKeyhole, Menu, MessageCircle,
  Download, Moon, Play, Rocket, Settings, ShieldCheck, Sparkles, Sun, Target, Trash2, Trophy, Users, X,
} from 'lucide-react';
import { APP } from './config';
import { academyApi, ApiError } from './api';

type View = 'home' | 'placement' | 'auth' | 'forgot' | 'reset' | 'verify' | 'checkout' | 'payment-return' | 'onboarding' | 'dashboard' | 'lesson' | 'parent' | 'instructor' | 'account' | 'notifications';
type TestAnswer = number | null;
const storedViewKey = 'yaa_current_view';
const viewsByRole: Record<string, ReadonlySet<View>> = {
  student: new Set(['dashboard', 'lesson', 'account', 'notifications', 'checkout', 'onboarding', 'verify']),
  parent: new Set(['parent', 'account', 'notifications']),
  instructor: new Set(['instructor', 'account', 'notifications']),
  teaching_assistant: new Set(['instructor', 'account', 'notifications']),
  content_editor: new Set(['instructor', 'account', 'notifications']),
  support_agent: new Set(['instructor', 'account', 'notifications']),
  finance_manager: new Set(['instructor', 'account', 'notifications']),
  super_admin: new Set(['instructor', 'account', 'notifications']),
};
const homeForRole = (role: string): View =>
  role === 'student' ? 'dashboard' : role === 'parent' ? 'parent' : 'instructor';

function InnerMark({ size = 25 }: { size?: number }) {
  return <svg className="inner-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M8 8.5 16 4l8 4.5v9L16 22l-8-4.5v-9Z" />
    <path d="M12 11.2 16 9l4 2.2v4.6L16 18l-4-2.2v-4.6Z" />
    <path d="M16 22v6M11.5 25h9" />
    <circle cx="16" cy="13.5" r="1.8" />
  </svg>;
}

const questions = [
  { q: 'أي خطوة تأتي أولًا عند حل مشكلة برمجية؟', a: ['كتابة الكود فورًا', 'فهم المشكلة وتقسيمها', 'اختيار الألوان', 'حفظ الحل'], correct: 1 },
  { q: 'ما الناتج المتوقع من: 3 + 2 × 2 ؟', a: ['10', '7', '8', '12'], correct: 1 },
  { q: 'أي وصف أدق للخوارزمية؟', a: ['جهاز حاسوب', 'لغة برمجة فقط', 'خطوات مرتبة لحل مشكلة', 'نوع من الصور'], correct: 2 },
  { q: 'ماذا يفعل المتغير في البرمجة؟', a: ['يخزن قيمة قابلة للاستخدام', 'يسرّع الإنترنت', 'يرسم الشاشة', 'يطفئ الحاسوب'], correct: 0 },
  { q: 'إذا كان x = 5، فمتى يتحقق الشرط x > 3؟', a: ['دائمًا في هذا المثال', 'لا يتحقق', 'عند حذف x', 'لا يمكن معرفة ذلك'], correct: 0 },
  { q: 'أفضل طريقة لتعلم البرمجة هي…', a: ['المشاهدة فقط', 'الحفظ', 'التطبيق وبناء مشاريع', 'تجنب الأخطاء'], correct: 2 },
];

const modules = [
  ['01', 'كيف يفكر الكمبيوتر؟', '12 دقيقة', true],
  ['02', 'الخوارزميات والتفكير المنطقي', '18 دقيقة', false],
  ['03', 'البداية مع Python', '24 دقيقة', false],
  ['04', 'المتغيرات والشروط والحلقات', '32 دقيقة', false],
  ['05', 'الدوال وتقسيم المشكلة', '28 دقيقة', false],
  ['06', 'مقدمة في البيانات', '25 دقيقة', false],
  ['07', 'ما هو الذكاء الاصطناعي؟', '21 دقيقة', false],
  ['08', 'المشروع النهائي: مساعد دراسي', 'مشروع', false],
] as const;

function useLocalProgress() {
  const [progress, setProgress] = useState(() => Number(localStorage.getItem('yaa-progress') || 35));
  useEffect(() => localStorage.setItem('yaa-progress', String(progress)), [progress]);
  return [progress, setProgress] as const;
}

export function App() {
  const initialView = useMemo<View>(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has('resetToken')) return 'reset';
    if (query.has('payment')) return 'payment-return';
    return 'home';
  }, []);
  const [view, setView] = useState<View>(initialView);
  const [restoringSession, setRestoringSession] = useState(initialView === 'home');
  const [dark, setDark] = useState(true);
  const [menu, setMenu] = useState(false);
  const [progress] = useLocalProgress();
  const go = (next: View) => {
    setView(next);
    setMenu(false);
    if (next === 'home' || next === 'auth') sessionStorage.removeItem(storedViewKey);
    else sessionStorage.setItem(storedViewKey, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (initialView !== 'home') {
      setRestoringSession(false);
      return;
    }
    let active = true;
    academyApi.me().then(({ user }) => {
      if (!active) return;
      const stored = sessionStorage.getItem(storedViewKey) as View | null;
      const next = stored && viewsByRole[user.role]?.has(stored) ? stored : homeForRole(user.role);
      setView(next);
    }).catch(() => {
      if (active) sessionStorage.removeItem(storedViewKey);
    }).finally(() => {
      if (active) setRestoringSession(false);
    });
    return () => { active = false; };
  }, [initialView]);

  return (
    <div className={dark ? 'app dark' : 'app light'} dir="rtl">
      <header className="topbar">
        <button className="brand" onClick={() => go('home')} aria-label="الصفحة الرئيسية">
          <span className="brand-mark"><InnerMark /></span>
          <span><b>{APP.name}</b><small>مختبر مستقبلك يبدأ هنا</small></span>
        </button>
        <nav className={menu ? 'nav open' : 'nav'}>
          <button onClick={() => go('home')}>الرئيسية</button>
          <a href="#paths" onClick={() => setMenu(false)}>المسارات</a>
          <a href="#method" onClick={() => setMenu(false)}>كيف نتعلم؟</a>
          <a href="#pricing" onClick={() => setMenu(false)}>الأسعار</a>
          <button onClick={() => go('parent')}>ولي الأمر</button>
          <button className="mobile-nav-only" onClick={() => go('auth')}>تسجيل الدخول</button>
        </nav>
        <div className="top-actions">
          <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="تغيير المظهر">{dark ? <Sun /> : <Moon />}</button>
          <button className="text-btn" onClick={() => go('auth')}>تسجيل الدخول</button>
          <button className="primary small" onClick={() => go('placement')}>اختبر مستواك</button>
          <button className="icon-btn mobile-only" aria-label="فتح القائمة" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
        </div>
      </header>

      {restoringSession
        ? <main className="flow-page" aria-busy="true"><div className="form-card question-card"><span className="eyebrow">جارٍ استعادة جلستك</span><h1>نفتح مختبرك من حيث توقفت...</h1></div></main>
        : view === 'home' && <Home go={go} />}
      {view === 'placement' && <Placement go={go} />}
      {view === 'auth' && <Auth go={go} />}
      {view === 'forgot' && <ForgotPassword go={go} />}
      {view === 'reset' && <ResetPassword go={go} />}
      {view === 'verify' && <VerifyEmail go={go} />}
      {view === 'checkout' && <Checkout go={go} />}
      {view === 'payment-return' && <PaymentReturn go={go} />}
      {view === 'onboarding' && <Onboarding go={go} />}
      {view === 'dashboard' && <Dashboard go={go} progress={progress} />}
      {view === 'lesson' && <Lesson go={go} />}
      {view === 'parent' && <Parent go={go} />}
      {view === 'instructor' && <Instructor go={go} />}
      {view === 'account' && <Account go={go} />}
      {view === 'notifications' && <Notifications go={go} />}
      <Assistant />
    </div>
  );
}

function Home({ go }: { go: (v: View) => void }) {
  return <>
    <main>
      <section className="hero">
        <div className="orb orb-a" /><div className="orb orb-b" />
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={16} /> تعلّم يصنع الفارق — لا مجرد مشاهدة</span>
          <h1>اتعلّم. طبّق.<br/><em>اصنع مستقبلك.</em></h1>
          <p>ابدأ رحلتك في البرمجة والذكاء الاصطناعي مع م. محمد ياسر. شرح عربي واضح، تطبيق حقيقي، ومسار يناسب مستواك.</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => go('placement')}>ابدأ اختبار مستواك مجانًا <ArrowLeft /></button>
            <button className="secondary" onClick={() => go('lesson')}><CirclePlay /> شاهد درسًا تجريبيًا</button>
          </div>
          <div className="trust-row">
            <span><Check /> بدون بطاقة بنكية</span><span><Check /> النتيجة في 5 دقائق</span><span><Check /> مناسب لطلاب الثانوية</span>
          </div>
        </div>
        <div className="founder-visual" aria-label="م. محمد ياسر، مدرب البرمجة والذكاء الاصطناعي">
          <div className="founder-halo" />
          <div className="founder-grid" />
          <img src="/images/founder-portrait.png" alt="م. محمد ياسر" />
          <div className="founder-badge"><span className="live-dot" /><span><b>م. محمد ياسر</b><small>مدرب برمجة وذكاء اصطناعي</small></span></div>
          <div className="float-card founder-card"><BrainCircuit /><span><b>تعلم عملي</b> من الفكرة إلى المشروع</span></div>
        </div>
      </section>

      <section className="stats">
        <div><b>8</b><span>وحدات عملية</span></div><div><b>24+</b><span>تحديًا برمجيًا</span></div><div><b>4</b><span>مشاريع حقيقية</span></div><div><b>1:1</b><span>مساعد تعلم ذكي</span></div>
      </section>

      <section className="section" id="paths">
        <div className="section-head"><span className="eyebrow">مسارات مصممة لتوصلك</span><h2>اختر نقطة البداية، وسنرسم معًا الطريق.</h2><p>كل مسار يجمع بين الفهم والتطبيق والمشروع.</p></div>
        <div className="path-grid">
          {[
            [Code2, 'أساسيات البرمجة', 'ابدأ من الصفر وافهم طريقة تفكير المبرمج.', '12 درسًا', 'cyan'],
            [Rocket, 'Python من البداية', 'اكتب برامج حقيقية بلغة سهلة وقوية.', '18 درسًا', 'violet'],
            [BrainCircuit, 'الذكاء الاصطناعي', 'افهم AI وابنِ أول نموذج ذكي خاص بك.', '16 درسًا', 'orange'],
            [Target, 'مشاريع الثانوية', 'حوّل معرفتك إلى مشاريع تميز ملفك.', '8 مشاريع', 'green'],
          ].map(([Icon, title, desc, count, color]) => {
            const I = Icon as typeof Code2;
            return <article className={`path-card ${color}`} key={title as string}><div className="path-icon"><I /></div><span>{count as string}</span><h3>{title as string}</h3><p>{desc as string}</p><button onClick={() => go('checkout')}>استكشف المسار <ChevronLeft /></button></article>;
          })}
        </div>
      </section>

      <section className="method section" id="method">
        <div className="method-copy"><span className="eyebrow">منهجية مختلفة</span><h2>شاهد. طبّق. ابنِ.</h2><p>لا نؤمن بحفظ الأكواد. كل مفهوم يتحول فورًا إلى تجربة، وكل تجربة تقود إلى مشروع تفتخر به.</p>
          <div className="steps">{[['01','شرح بصري واضح','فيديوهات قصيرة وأمثلة من حياتك.'],['02','تطبيق فوري','محرر كود داخل المنصة مع تصحيح ذكي.'],['03','مشروع حقيقي','طبّق مهارتك وشارك إنجازك.']].map(x=><div key={x[0]}><b>{x[0]}</b><span><strong>{x[1]}</strong><small>{x[2]}</small></span></div>)}</div>
        </div>
        <div className="mentor-card"><div className="mentor-avatar mentor-photo"><img src="/images/founder-portrait.png" alt="" /></div><span className="live-tag"><i/> معك خطوة بخطوة</span><h3>م. محمد ياسر</h3><p>مدرّب برمجة وذكاء اصطناعي</p><blockquote>“هدفي أن تفهم لماذا يعمل الكود، لا أن تحفظ كيف تكتبه.”</blockquote></div>
      </section>

      <section className="section pricing-section" id="pricing">
        <div className="section-head"><span className="eyebrow">استثمار في مستقبلك</span><h2>باقة واضحة، بلا مفاجآت.</h2></div>
        <div className="pricing-card">
          <div><span className="popular">الأكثر اختيارًا</span><h3>مسار الانطلاقة الكامل</h3><p>كل ما تحتاجه من أول سطر كود إلى مشروع AI.</p><div className="price"><b>799</b><span>جنيه / فصل دراسي</span></div><button className="primary" onClick={() => go('checkout')}>ابدأ الآن <ArrowLeft /></button></div>
          <ul><li><Check/> 8 وحدات و40+ درسًا</li><li><Check/> محرر كود وتمارين تفاعلية</li><li><Check/> 4 مشاريع بتقييم المدرّب</li><li><Check/> مساعد تعلم ذكي آمن</li><li><Check/> تقارير أسبوعية لولي الأمر</li><li><Check/> شهادة إتمام قابلة للتحقق</li></ul>
        </div>
      </section>
      <section className="final-cta"><Sparkles/><h2>مستقبلك لا ينتظر. وأول خطوة مجانية.</h2><p>اكتشف مستواك واحصل على خطة تعلم شخصية في دقائق.</p><button className="primary" onClick={() => go('placement')}>ابدأ اختبار المستوى <ArrowLeft/></button></section>
    </main>
    <Footer go={go}/>
  </>;
}

function Placement({ go }: { go: (v: View) => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<TestAnswer[]>(Array(questions.length).fill(null));
  const [done, setDone] = useState(false);
  const score = useMemo(() => answers.filter((a, i) => a === questions[i].correct).length, [answers]);
  if (done) return <main className="flow-page"><div className="result-card"><div className="result-orbit"><b>{Math.round(score/questions.length*100)}%</b><span>نتيجتك</span></div><span className="eyebrow">أحسنت! تم تحليل إجاباتك</span><h1>مستواك: <em>{score > 4 ? 'مستكشف متقدم' : 'مستكشف واعد'}</em></h1><p>لديك أساس منطقي جيد واستعداد ممتاز للتعلم بالتطبيق. مسار الانطلاقة هو الأنسب لبناء أساس قوي ثم الانتقال إلى Python.</p><div className="result-grid"><div><Trophy/><b>نقطة قوة</b><span>التفكير المنطقي</span></div><div><Target/><b>ركّز على</b><span>قراءة الكود</span></div><div><Compass/><b>مسارك</b><span>أساسيات + Python</span></div></div><button className="primary wide" onClick={() => go('auth')}>احفظ نتيجتك وأنشئ حسابك <ArrowLeft/></button><button className="link-btn" onClick={() => go('home')}>العودة للرئيسية</button></div></main>;
  const q = questions[index];
  const choose = (a: number) => { const next = [...answers]; next[index] = a; setAnswers(next); };
  return <main className="flow-page"><div className="test-shell">
    <div className="flow-top"><button className="brand" onClick={()=>go('home')}><span className="brand-mark"><InnerMark/></span><b>{APP.name}</b></button><span><Clock3/> حوالي 5 دقائق</span></div>
    <div className="progress-top"><span>السؤال {index+1} من {questions.length}</span><b>{Math.round((index+1)/questions.length*100)}%</b></div><div className="progress-line"><i style={{width:`${(index+1)/questions.length*100}%`}}/></div>
    <div className="question-card"><span className="question-type">تفكير منطقي</span><h1>{q.q}</h1><div className="answers">{q.a.map((answer,a)=><button className={answers[index]===a?'selected':''} key={answer} onClick={()=>choose(a)}><i>{['أ','ب','ج','د'][a]}</i>{answer}{answers[index]===a&&<Check/>}</button>)}</div>
      <div className="question-nav"><button className="secondary" disabled={index===0} onClick={()=>setIndex(index-1)}>السابق</button><button className="primary" disabled={answers[index]===null} onClick={()=>index===questions.length-1?setDone(true):setIndex(index+1)}>{index===questions.length-1?'عرض النتيجة':'السؤال التالي'} <ChevronLeft/></button></div>
    </div><p className="privacy-note"><ShieldCheck/> إجاباتك خاصة وتستخدم فقط لبناء مسارك.</p>
  </div></main>;
}

function Auth({ go }: { go: (v: View) => void }) {
  const [login, setLogin] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (login) {
        const result = await academyApi.login({ email, password });
        go(result.user.role === 'student' ? 'dashboard' : result.user.role === 'parent' ? 'parent' : 'instructor');
      } else {
        await academyApi.register({ fullName, email, password, acceptedTerms: acceptedTerms as true });
        go('verify');
      }
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'NETWORK_ERROR';
      setError(code === 'EMAIL_EXISTS' ? 'هذا البريد مسجل بالفعل.' : code === 'INVALID_CREDENTIALS' ? 'البريد أو كلمة المرور غير صحيحة.' : 'تعذر الاتصال بالخادم. تأكد من تشغيل API.');
    } finally {
      setSubmitting(false);
    }
  };
  return <main className="flow-page split-flow"><div className="auth-art"><BrainCircuit size={54}/><h1>مختبرك جاهز.<br/><em>بقي أن تدخل.</em></h1><p>احتفظ بنتيجة اختبارك وابدأ أول مهمة في رحلتك.</p><div className="mini-quote"><div className="mentor-avatar small-avatar">MY</div><span><q>سأكون معك في كل خطوة.</q><small>م. محمد ياسر</small></span></div></div><form className="form-card" onSubmit={submit}><span className="eyebrow">{login?'مرحبًا بعودتك':'حسابك الجديد'}</span><h2>{login?'سجّل دخولك':'لنحفظ تقدمك'}</h2><p>{login?'أكمل من حيث توقفت.':'أدخل بيانات بسيطة لبدء رحلتك.'}</p>{!login&&<label>الاسم الكامل<input required value={fullName} onChange={event=>setFullName(event.target.value)} placeholder="مثال: عمر أحمد"/></label>}<label>البريد الإلكتروني<input required type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@example.com"/></label><label>كلمة المرور<input required type="password" minLength={login?8:12} value={password} onChange={event=>setPassword(event.target.value)} placeholder={login?'كلمة المرور':'12 حرفًا تشمل كبيرًا وصغيرًا ورقمًا ورمزًا'}/></label>{!login&&<small className="password-hint">استخدم 12 حرفًا على الأقل مع حرف كبير وصغير ورقم ورمز.</small>}{!login&&<label className="check-label"><input required type="checkbox" checked={acceptedTerms} onChange={event=>setAcceptedTerms(event.target.checked)}/> أوافق على الشروط وسياسة الخصوصية.</label>}{error&&<div className="feedback bad">{error}</div>}<button className="primary wide" type="submit" disabled={submitting}>{submitting?'جارٍ التحقق...':login?'دخول إلى المختبر':'إنشاء الحساب والمتابعة'} {!submitting&&<ArrowLeft/>}</button>{login&&<button type="button" className="link-btn" onClick={()=>go('forgot')}>نسيت كلمة المرور؟</button>}<button type="button" className="link-btn" onClick={()=>setLogin(!login)}>{login?'ليس لديك حساب؟ أنشئ حسابًا':'لديك حساب بالفعل؟ سجّل الدخول'}</button><div className="demo-box">حساب الطالب التجريبي: student@yasser-ai.demo — كلمة المرور: Demo@2026!</div></form></main>;
}

function ForgotPassword({go}:{go:(v:View)=>void}){
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const [sent,setSent]=useState(false);
  const [error,setError]=useState('');
  const submit=async(event:FormEvent)=>{event.preventDefault();setLoading(true);setError('');try{const result=await academyApi.forgotPassword(email);setSent(true);if(result.developmentToken){sessionStorage.setItem('yaa_reset_token',result.developmentToken);go('reset')}}catch{setError('تعذر إرسال طلب الاسترجاع الآن. حاول مرة أخرى.')}finally{setLoading(false)}};
  return <main className="flow-page"><form className="form-card question-card" onSubmit={submit}><span className="eyebrow"><ShieldCheck/> استرجاع آمن</span><h1>استعادة كلمة المرور</h1><p>أدخل بريدك. إذا كان الحساب موجودًا سنرسل رابطًا صالحًا لمدة 30 دقيقة.</p><label>البريد الإلكتروني<input type="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@example.com"/></label>{sent&&<div className="feedback good" role="status">تم قبول الطلب. راجع بريدك لإكمال الاسترجاع.</div>}{error&&<div className="feedback bad" role="alert">{error}</div>}<button className="primary wide" disabled={loading}>{loading?'جارٍ الإرسال...':'إرسال رابط الاسترجاع'}</button><button type="button" className="link-btn" onClick={()=>go('auth')}>العودة لتسجيل الدخول</button></form></main>;
}

function ResetPassword({go}:{go:(v:View)=>void}){
  const queryToken=new URLSearchParams(window.location.search).get('resetToken')||'';
  const [token,setToken]=useState(queryToken||sessionStorage.getItem('yaa_reset_token')||'');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const submit=async(event:FormEvent)=>{event.preventDefault();setError('');if(password!==confirmation){setError('كلمتا المرور غير متطابقتين.');return}setLoading(true);try{await academyApi.resetPassword(token,password);sessionStorage.removeItem('yaa_reset_token');window.history.replaceState({},'',window.location.pathname);go('auth')}catch{setError('الرابط غير صالح أو انتهت صلاحيته، أو كلمة المرور لا تحقق الشروط.')}finally{setLoading(false)}};
  return <main className="flow-page"><form className="form-card question-card" onSubmit={submit}><span className="eyebrow"><LockKeyhole/> كلمة مرور جديدة</span><h1>تعيين كلمة المرور</h1><p>استخدم 12 حرفًا على الأقل تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.</p>{!queryToken&&<label>رمز الاسترجاع<input required minLength={32} value={token} onChange={event=>setToken(event.target.value)}/></label>}<label>كلمة المرور الجديدة<input type="password" required minLength={12} value={password} onChange={event=>setPassword(event.target.value)}/></label><label>تأكيد كلمة المرور<input type="password" required minLength={12} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>{error&&<div className="feedback bad" role="alert">{error}</div>}<button className="primary wide" disabled={loading||token.length<32}>{loading?'جارٍ الحفظ...':'حفظ كلمة المرور'}</button></form></main>;
}

function VerifyEmail({ go }: { go: (v: View) => void }) {
  const [otp, setOtp] = useState('');
  const [developmentOtp, setDevelopmentOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const initialRequestSent = useRef(false);
  const requestOtp = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await academyApi.requestEmailVerification();
      if (result.alreadyVerified) return go('checkout');
      setDevelopmentOtp(result.developmentOtp || '');
    } catch { setError('تعذر إرسال رمز التحقق. حاول مرة أخرى بعد قليل.'); }
    finally { setLoading(false); }
  }, [go]);
  useEffect(() => {
    if (initialRequestSent.current) return;
    initialRequestSent.current = true;
    void requestOtp();
  }, [requestOtp]);
  const verify = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try { await academyApi.verifyEmail(otp); go('checkout'); }
    catch { setError('الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.'); }
    finally { setLoading(false); }
  };
  return <main className="flow-page"><form className="form-card question-card" onSubmit={verify}>
    <span className="eyebrow"><ShieldCheck/> حماية حسابك</span><h1>تحقق من بريدك الإلكتروني</h1>
    <p>أرسلنا رمزًا من 6 أرقام. تنتهي صلاحيته خلال 10 دقائق.</p>
    {developmentOtp&&<div className="demo-box">رمز بيئة التطوير: <b>{developmentOtp}</b></div>}
    <label>رمز التحقق<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))} placeholder="000000"/></label>
    {error&&<div className="feedback bad">{error}</div>}
    <button className="primary wide" disabled={loading||otp.length!==6}>{loading?'جارٍ التحقق...':'تأكيد البريد'} <ArrowLeft/></button>
    <button type="button" className="link-btn" disabled={loading} onClick={()=>void requestOtp()}>إرسال رمز جديد</button>
  </form></main>;
}

function Checkout({ go }: { go: (v: View) => void }) {
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const pay = async () => {
    setPaying(true); setError('');
    try {
      const courses = await academyApi.courses();
      const course = courses.data[0];
      if (!course) throw new Error('No course');
      const order = await academyApi.checkout(course.id, crypto.randomUUID());
      if (order.provider === 'sandbox') {
        await academyApi.sandboxPay(order.order.id);
        setPaid(true);
      } else {
        const checkoutUrl = new URL(order.checkoutUrl);
        if (checkoutUrl.protocol !== 'https:') throw new Error('Unsafe checkout URL');
        window.location.assign(checkoutUrl.href);
      }
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? 'سجّل الدخول أولًا لإكمال الاشتراك.' : 'تعذر بدء عملية الدفع. حاول مرة أخرى.');
    } finally { setPaying(false); }
  };
  if (paid) return <main className="flow-page"><div className="success-card"><div className="success-icon"><Check/></div><span className="eyebrow">تم تفعيل اشتراكك بنجاح</span><h1>أهلًا بك في المختبر، يا بطل! 🚀</h1><p>رحلتك أصبحت جاهزة. سنضبط خطتك الأولى في أقل من دقيقة.</p><button className="primary" onClick={()=>go('onboarding')}>جهّز مختبري الآن <ArrowLeft/></button></div></main>;
  const sandbox=APP.paymentMode==='sandbox';
  return <main className="flow-page"><div className="checkout-shell"><div className="form-card"><span className="eyebrow">{sandbox?'دفع تجريبي آمن':'دفع آمن عبر مزوّد معتمد'}</span><h1>أكمل اشتراكك</h1><p>{sandbox?'لن يتم خصم أي مبلغ حقيقي في وضع العرض.':'ستنتقل إلى صفحة المزوّد الآمنة لإدخال وسيلة الدفع.'}</p>{sandbox&&<><label>اسم حامل البطاقة<input defaultValue="Mohamed Yasser"/></label><label>رقم البطاقة<input defaultValue="4242 4242 4242 4242"/></label><div className="two-cols"><label>تاريخ الانتهاء<input defaultValue="12/30"/></label><label>CVV<input defaultValue="123"/></label></div></>}{error&&<div className="feedback bad" role="alert">{error}</div>}<button className="primary wide" disabled={paying} onClick={()=>void pay()}><LockKeyhole/> {paying?'جارٍ تجهيز الدفع...':sandbox?'دفع تجريبي 799 جنيه':'المتابعة إلى الدفع الآمن'}</button><span className="secure"><ShieldCheck/> {sandbox?'بيانات عرض فقط • Sandbox':'لا تخزن المنصة بيانات البطاقة'}</span></div><aside className="order-card"><span>ملخص الطلب</span><h3>مسار الانطلاقة الكامل</h3><ul><li>اشتراك فصل دراسي <b>899 ج</b></li><li>خصم البداية <b className="green">−100 ج</b></li></ul><div className="order-total"><span>الإجمالي</span><b>799 جنيه</b></div><small>ضمان استرجاع خلال 7 أيام وفق الشروط.</small></aside></div></main>;
}

function PaymentReturn({go}:{go:(v:View)=>void}){
  const [state,setState]=useState<'checking'|'succeeded'|'pending'|'cancelled'|'error'>(()=>
    new URLSearchParams(window.location.search).get('payment')==='cancelled'?'cancelled':'checking');
  const check=useCallback(async()=>{
    setState('checking');
    try{
      const orderId=new URLSearchParams(window.location.search).get('orderId');
      const orders=await academyApi.orders();
      const order=orders.data.find(item=>item.id===orderId);
      setState(order?.status==='succeeded'?'succeeded':order?.status==='cancelled'?'cancelled':'pending');
    }catch{setState('error')}
  },[]);
  useEffect(()=>{if(state==='checking')void check()},[check,state]);
  if(state==='checking')return <main className="flow-page"><div className="form-card question-card"><span className="eyebrow">جارٍ التحقق</span><h1>نتأكد من حالة الدفع...</h1><p role="status">لا تغلق الصفحة حتى تصلنا نتيجة المزوّد.</p></div></main>;
  if(state==='succeeded')return <main className="flow-page"><div className="success-card"><div className="success-icon"><Check/></div><h1>تم تفعيل اشتراكك بنجاح</h1><p>وصل تأكيد الدفع من الخادم وأصبح مسارك جاهزًا.</p><button className="primary" onClick={()=>go('onboarding')}>جهّز مختبري <ArrowLeft/></button></div></main>;
  return <main className="flow-page"><div className="form-card question-card"><span className="eyebrow">{state==='cancelled'?'تم إلغاء الدفع':'الدفع قيد التحقق'}</span><h1>{state==='error'?'تعذر التحقق من حالة الطلب':state==='pending'?'لم يصل التأكيد بعد':'لم يتم خصم المبلغ'}</h1><p>{state==='pending'?'قد يستغرق webhook عدة ثوانٍ. أعد التحقق دون إنشاء طلب جديد.':'يمكنك العودة والمحاولة مرة أخرى بأمان.'}</p>{state==='pending'&&<button className="primary" onClick={()=>void check()}>إعادة التحقق</button>}<button className="secondary" onClick={()=>go('checkout')}>العودة للدفع</button></div></main>;
}

function Onboarding({ go }: { go: (v: View) => void }) {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState('بدء البرمجة من الصفر');
  const screens = [
    <div className="onboard-content"><div className="mentor-avatar huge">MY</div><span className="eyebrow">رسالة من م. محمد ياسر</span><h1>أهلًا بك في مختبرك!</h1><p>هنا لن تحفظ أكوادًا؛ ستفهم، تجرّب، وتبني. أنا معك في كل مهمة.</p></div>,
    <div className="onboard-content"><Target size={48}/><span className="eyebrow">خطوتك الأولى</span><h1>ما هدفك الأساسي؟</h1><div className="goal-grid">{['بدء البرمجة من الصفر','التفوق في مادة المدرسة','الاستعداد للجامعة','بناء مشروع خاص'].map(g=><button className={goal===g?'selected':''} key={g} onClick={()=>setGoal(g)}>{g}{goal===g&&<Check/>}</button>)}</div></div>,
    <div className="onboard-content"><Clock3 size={48}/><span className="eyebrow">إيقاع يناسبك</span><h1>كم يومًا تود الدراسة؟</h1><div className="day-pills">{[2,3,4,5].map(d=><button className={d===3?'selected':''} key={d}>{d} أيام</button>)}</div><p>نرشّح 3 أيام × 35 دقيقة لتحقيق تقدم ثابت.</p></div>,
    <div className="onboard-content"><div className="success-icon"><Sparkles/></div><span className="eyebrow">اكتملت الخطة</span><h1>تم تجهيز مختبرك.</h1><p>هدفك: {goal}. أول أسبوع يضم 3 مهام قصيرة ومشروعًا مصغرًا.</p><div className="week-plan"><span><b>السبت</b> كيف يفكر الكمبيوتر؟</span><span><b>الاثنين</b> أول خوارزمية</span><span><b>الأربعاء</b> تحدّي المنطق</span></div></div>
  ];
  return <main className="flow-page"><div className="onboard-card"><div className="dots">{screens.map((_,i)=><i className={i<=step?'active':''} key={i}/>)}</div>{screens[step]}<button className="primary" onClick={()=>step===3?go('dashboard'):setStep(step+1)}>{step===3?'ابدأ أول مهمة':'متابعة'} <ArrowLeft/></button></div></main>;
}

function Dashboard({ go, progress }: { go:(v:View)=>void; progress:number }) {
  const [course, setCourse] = useState<{ title: string; total_lessons: number; completed_lessons: number } | null>(null);
  const [dashboardState, setDashboardState] = useState<'loading'|'ready'|'empty'|'error'>('loading');
  useEffect(() => {
    let active = true;
    void academyApi.dashboard().then((response) => {
      if (!active) return;
      setCourse(response.data[0] ?? null);
      setDashboardState(response.data.length ? 'ready' : 'empty');
    }).catch(() => active && setDashboardState('error'));
    return () => { active = false; };
  }, []);
  const serverProgress = course?.total_lessons
    ? Math.round(course.completed_lessons / course.total_lessons * 100)
    : progress;
  if (dashboardState === 'loading') return <main className="flow-page" aria-busy="true"><div className="form-card question-card"><span className="eyebrow">جارٍ تجهيز مختبرك</span><h1>نحمّل تقدمك...</h1></div></main>;
  if (dashboardState === 'error') return <main className="flow-page"><div className="form-card question-card"><span className="eyebrow">تعذر تحميل البيانات</span><h1>لم نتمكن من تحميل لوحة التعلم</h1><p>تحقق من اتصال الخادم ثم حاول مرة أخرى.</p><button className="primary" onClick={()=>window.location.reload()}>إعادة المحاولة</button></div></main>;
  if (dashboardState === 'empty') return <main className="flow-page"><div className="form-card question-card"><span className="eyebrow">لا يوجد اشتراك نشط</span><h1>ابدأ أول مسار لك</h1><p>اختر المسار المناسب ثم أكمل الاشتراك لعرض مهامك هنا.</p><button className="primary" onClick={()=>go('home')}>استعراض المسارات</button></div></main>;
  return <main className="dashboard-layout"><SideNav go={go}/><div className="dash-main"><div className="dash-top"><div><span>الخميس، 23 يوليو</span><h1>صباح الإنجاز، محمد 👋</h1></div><div><button className="icon-btn" aria-label="إعدادات الحساب" onClick={()=>go('account')}><Settings/></button><button className="icon-btn" aria-label="عرض الإشعارات" onClick={()=>go('notifications')}><Bell/></button><div className="avatar">MY</div></div></div>
    <section className="mission-card"><div><span className="eyebrow"><Flame/> سلسلة تعلم: 7 أيام</span><h2>مهمتك التالية: كيف يفكر الكمبيوتر؟</h2><p>اكتشف كيف يحوّل الكمبيوتر أوامرك إلى خطوات دقيقة.</p><div className="lesson-meta"><span><CirclePlay/> 12 دقيقة</span><span><Code2/> تمرين واحد</span><span><Award/> +120 نقطة</span></div><button className="primary" onClick={()=>go('lesson')}><Play/> ابدأ المهمة</button></div><div className="mission-orbit"><BrainCircuit/><span>المهمة 1</span></div></section>
    <div className="kpi-grid"><div><span><Gauge/> تقدم المسار</span><b>{serverProgress}%</b><div className="mini-progress"><i style={{width:`${serverProgress}%`}}/></div></div><div><span><Clock3/> وقت التعلم</span><b>4.5 <small>ساعة</small></b><em>+48 دقيقة هذا الأسبوع</em></div><div><span><Trophy/> نقاطك</span><b>1,240</b><em>#12 في مجموعتك</em></div><div><span><Target/> المهام</span><b>{course?.completed_lessons ?? 0} <small>/ {course?.total_lessons ?? 0}</small></b><em>استمر في مهمتك التالية</em></div></div>
    <section className="dash-section"><div className="title-row"><div><span className="eyebrow">مسارك الحالي</span><h2>{course?.title}</h2></div><button className="secondary" onClick={()=>go('lesson')}>عرض أول مهمة</button></div><div className="module-list">{modules.slice(0,4).map((m,i)=><button className={i===0?'active':''} key={m[0]} disabled={i!==0} onClick={()=>go('lesson')}><i>{i===0?<Play/>:i<3?<Check/>:<LockKeyhole/>}</i><span><small>الوحدة {m[0]}</small><b>{m[1]}</b></span><em>{m[2]}</em><ChevronLeft/></button>)}</div></section>
  </div></main>;
}

function SideNav({go}:{go:(v:View)=>void}){return <aside className="side-nav"><button className="brand" onClick={()=>go('home')}><span className="brand-mark"><InnerMark/></span><b>inner</b></button><nav><button className="active" onClick={()=>go('dashboard')}><LayoutDashboard/> لوحة التحكم</button><button onClick={()=>go('lesson')}><Compass/> مساري التعليمي</button><button onClick={()=>go('notifications')}><Bell/> الإشعارات</button><button onClick={()=>go('account')}><Settings/> الحساب والخصوصية</button></nav><div className="side-bottom"><button onClick={()=>go('parent')}><Users/> لوحة ولي الأمر</button><button onClick={()=>go('instructor')}><BarChart3/> لوحة المدرّس</button></div></aside>}

function Lesson({go}:{go:(v:View)=>void}){
  const [tab,setTab]=useState<'learn'|'quiz'|'code'>('learn'); const [answer,setAnswer]=useState<number|null>(null); const [run,setRun]=useState(false);
  const [source,setSource]=useState('message = "أنا مستعد للمستقبل!"\nprint(message)');
  const [output,setOutput]=useState(''); const [running,setRunning]=useState(false);
  const [lessonError,setLessonError]=useState('');
  const saveProgress=async()=>{try{await academyApi.updateProgress('33333333-3333-4333-8333-333333333333',700,700);setLessonError('')}catch{setLessonError('تعذر حفظ تقدم الفيديو. سنحاول مجددًا عند عودة الاتصال.')}};
  const chooseAnswer=(choice:number)=>{setAnswer(choice);void academyApi.submitQuiz('44444444-4444-4444-8444-444444444444',[choice]).then(()=>setLessonError('')).catch(()=>setLessonError('تعذر حفظ نتيجة الاختبار. تحقق من الاتصال ثم حاول مجددًا.'))};
  const execute=async()=>{setRunning(true);try{const result=await academyApi.runCode(source,'أنا مستعد للمستقبل!');setOutput(result.data.stdout||result.data.stderr);setRun(result.data.status==='passed')}catch(error){setOutput(error instanceof ApiError&&error.status===401?'سجّل الدخول لتشغيل الكود.':'تعذر تشغيل الكود أو يحتوي على تعليمات غير مسموحة.')}finally{setRunning(false)}};
  return <main className="lesson-layout"><aside className="lesson-side"><button className="back" onClick={()=>go('dashboard')}><ArrowLeft/> العودة للوحة</button><span className="eyebrow">الوحدة الأولى</span><h3>كيف يفكر الكمبيوتر؟</h3><div className="mini-progress"><i style={{width:'35%'}}/></div>{['الفكرة الأساسية','شاهد وجرّب','اختبر فهمك','تحدّي الكود'].map((x,i)=><button className={tab===(['learn','learn','quiz','code'][i])?'active':''} onClick={()=>setTab((['learn','learn','quiz','code'] as const)[i])} key={x}><i>{i===0?<Check/>:i+1}</i>{x}</button>)}</aside><div className="lesson-main">
    <div className="lesson-header"><span>المهمة 1 من 24</span><div className="mini-progress"><i style={{width:'4%'}}/></div><b>+120 نقطة</b></div>
    {lessonError&&<div className="feedback bad" role="alert">{lessonError}</div>}
    {tab==='learn'&&<><div className="video-frame"><div className="video-glow"/><button aria-label="إكمال الفيديو وحفظ التقدم" onClick={()=>{void saveProgress();setTab('quiz')}}><Play/></button><span>كيف يحوّل الكمبيوتر أفكارنا إلى تعليمات؟</span><small>مدة الفيديو 12:08</small></div><article className="lesson-copy"><span className="eyebrow">الخلاصة</span><h1>الكمبيوتر سريع جدًا، لكنه يحتاج تعليمات دقيقة.</h1><p>تخيّل أنك تشرح لصديق طريقة صنع كوب شاي وهو لم يدخل المطبخ من قبل. كل خطوة يجب أن تكون واضحة ومرتبة. هذه هي فكرة <b>الخوارزمية</b>.</p><div className="insight"><BrainCircuit/><p><b>فكّر كمبرمج:</b> المشكلة الكبيرة تصبح أسهل عندما نقسمها إلى خطوات صغيرة يمكن اختبارها.</p></div><button className="primary" onClick={()=>{void saveProgress();setTab('quiz')}}>اختبر فهمك <ChevronLeft/></button></article></>}
    {tab==='quiz'&&<div className="lesson-task"><span className="eyebrow">اختبر فهمك • سؤال واحد</span><h1>ما أفضل وصف للخوارزمية؟</h1><div className="answers">{['لغة يفهمها الكمبيوتر فقط','خطوات واضحة ومرتبة لحل مشكلة','برنامج جاهز لا يتغير','جهاز لحفظ البيانات'].map((a,i)=><button className={answer===i?'selected':''} onClick={()=>chooseAnswer(i)} key={a}><i>{['أ','ب','ج','د'][i]}</i>{a}</button>)}</div>{answer!==null&&<div className={answer===1?'feedback good':'feedback bad'}>{answer===1?<><Check/> ممتاز! الترتيب والدقة هما جوهر الخوارزمية.</>:<>جرّب التفكير في وصفة طعام: هل هي جهاز أم خطوات مرتبة؟</>}</div>}<button className="primary" disabled={answer!==1} onClick={()=>setTab('code')}>انتقل لتحدي الكود <ChevronLeft/></button></div>}
    {tab==='code'&&<div className="lesson-task"><span className="eyebrow">تحدّي الكود</span><h1>اطبع أول رسالة لك للمستقبل.</h1><p>أكمل السطر ليطبع البرنامج: أنا مستعد للمستقبل!</p><div className="editor"><div className="window-top"><span/><span/><span/><b>mission_01.py</b></div><textarea value={source} onChange={event=>{setSource(event.target.value);setRun(false)}}/><div className="editor-actions"><button className="primary small" disabled={running} onClick={()=>void execute()}><Play/> {running?'جارٍ التشغيل...':'تشغيل'}</button></div>{output&&<pre>{output}{run&&'\nتم التنفيذ بنجاح'}</pre>}</div>{run&&<div className="feedback good"><Trophy/> رائع! أنهيت مهمتك الأولى وربحت 120 نقطة.</div>}<button className="primary" disabled={!run} onClick={()=>go('dashboard')}>إكمال المهمة وفتح التالية <ChevronLeft/></button></div>}
  </div></main>;
}

function Parent({go}:{go:(v:View)=>void}){
  const [children,setChildren]=useState<Array<{id:string;full_name:string;total_lessons:number;completed_lessons:number;watched_seconds:number}>>([]);
  const [state,setState]=useState<'loading'|'ready'|'empty'|'error'>('loading');
  useEffect(()=>{let active=true;void academyApi.parentChildren().then(result=>{if(active){setChildren(result.data);setState(result.data.length?'ready':'empty')}}).catch(()=>active&&setState('error'));return()=>{active=false}},[]);
  const child=children[0];
  const completion=child?.total_lessons?Math.round(child.completed_lessons/child.total_lessons*100):0;
  return <main className="dashboard-layout"><SideNav go={go}/><div className="dash-main"><div className="dash-top"><div><span>لوحة ولي الأمر</span><h1>{state==='loading'?'جارٍ تحميل تقرير الطالب...':child?`تقدم ${child.full_name} هذا الأسبوع`:'تقرير المتابعة'}</h1></div><button className="secondary" onClick={()=>go('home')}>الصفحة الرئيسية</button></div>
    {state==='error'&&<div className="feedback bad" role="alert">تعذر تحميل تقرير ولي الأمر. حاول مرة أخرى لاحقًا.</div>}
    {state==='empty'&&<section className="dash-section"><h2>لا يوجد طالب مرتبط بالحساب</h2><p className="report-text">اطلب من إدارة المنصة إرسال دعوة ربط آمنة.</p></section>}
    {child&&<><div className="child-card"><div className="avatar large">MY</div><div><h2>{child.full_name}</h2><p>مسار انطلاقة البرمجة والذكاء الاصطناعي</p></div><span className="status-ok"><i/> بيانات محدثة</span></div><div className="kpi-grid"><div><span><Clock3/> وقت التعلم</span><b>{Math.round(child.watched_seconds/60)} <small>دقيقة</small></b><em>من نشاط المنصة</em></div><div><span><Check/> الدروس المكتملة</span><b>{child.completed_lessons} <small>/ {child.total_lessons}</small></b><em>{completion}% من المسار</em></div><div><span><Award/> تقدم المسار</span><b>{completion}%</b><em>محسوب من الخادم</em></div><div><span><Flame/> الحالة</span><b>{completion>=50?'جيد':'متابعة'}</b><em>راجع الخطة أسبوعيًا</em></div></div><section className="dash-section"><div className="title-row"><div><span className="eyebrow">ملخص التقدم</span><h2>{completion>=50?'تقدم ثابت في المسار':'يحتاج إلى وقت تعلم إضافي'}</h2></div></div><p className="report-text">يعتمد هذا الملخص على الدروس المكتملة ووقت المشاهدة المسجل فعليًا في حساب الطالب.</p></section></>}
  </div></main>;
}

function Instructor({go}:{go:(v:View)=>void}){
  const [students,setStudents]=useState<Array<{id:string;full_name:string;email:string;last_activity:string|null;completed_lessons:number}>>([]);
  const [state,setState]=useState<'loading'|'ready'|'empty'|'error'>('loading');
  const [uploadState,setUploadState]=useState('');
  useEffect(()=>{let active=true;void academyApi.atRiskStudents().then(result=>{if(active){setStudents(result.data);setState(result.data.length?'ready':'empty')}}).catch(()=>active&&setState('error'));return()=>{active=false}},[]);
  const uploadMedia=async(file?:File)=>{if(!file)return;setUploadState('جارٍ رفع الملف...');try{const result=await academyApi.upload('lesson_media',file);setUploadState(`تم رفع ${result.data.filename} بنجاح`)}catch(error){setUploadState(error instanceof ApiError&&error.code==='FILE_TYPE_NOT_ALLOWED'?'نوع الملف غير مسموح.':'تعذر رفع الملف. تحقق من النوع والحجم ثم حاول مجددًا.')}};
  return <main className="dashboard-layout"><SideNav go={go}/><div className="dash-main"><div className="dash-top"><div><span>لوحة المدرّس</span><h1>نظرة عامة على المجموعة</h1></div><label className="primary small upload-action">رفع وسائط درس<input type="file" accept="video/mp4,audio/mpeg,image/png,image/jpeg,image/webp" onChange={event=>void uploadMedia(event.target.files?.[0])}/></label></div>
    {uploadState&&<div className={uploadState.startsWith('تم')?'feedback good':'feedback bad'} role="status">{uploadState}</div>}
    <div className="kpi-grid"><div><span><Users/> يحتاجون متابعة</span><b>{students.length}</b><em>من بيانات النشاط</em></div><div><span><BookOpen/> دروس مكتملة</span><b>{students.reduce((sum,item)=>sum+item.completed_lessons,0)}</b><em>للقائمة الحالية</em></div><div><span><Award/> حالة البيانات</span><b>{state==='ready'?'محدثة':'—'}</b><em>من API الإدارة</em></div><div><span><MessageCircle/> حالة التحميل</span><b>{state==='loading'?'...':'جاهز'}</b><em>تحديث تلقائي</em></div></div>
    <section className="dash-section"><div className="title-row"><div><span className="eyebrow">تنبيه مبكر</span><h2>طلاب يحتاجون دعمًا</h2></div><button className="secondary" onClick={()=>window.location.reload()}>تحديث</button></div>
      {state==='error'&&<div className="feedback bad" role="alert">تعذر تحميل قائمة المتابعة.</div>}
      {state==='empty'&&<p className="report-text">لا توجد حالات تحتاج متابعة حاليًا.</p>}
      {students.length>0&&<div className="student-table"><div><b>الطالب</b><b>آخر نشاط</b><b>الدروس</b><b>الحالة</b></div>{students.map(student=><div key={student.id}><span>{student.full_name}</span><span>{student.last_activity?new Date(student.last_activity).toLocaleDateString('ar-EG'):'لا يوجد'}</span><span>{student.completed_lessons}</span><span className="tag-danger">يحتاج تواصل</span></div>)}</div>}
    </section></div></main>;
}

function Account({go}:{go:(v:View)=>void}){
  const [sessions,setSessions]=useState<Array<{id:string;expiresAt:string;current:boolean}>>([]);
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [message,setMessage]=useState('');
  const [password,setPassword]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const loadSessions=useCallback(()=>{setState('loading');void academyApi.sessions().then(result=>{setSessions(result.data);setState('ready')}).catch(()=>setState('error'))},[]);
  useEffect(()=>loadSessions(),[loadSessions]);
  const revoke=async(id:string)=>{setMessage('');try{await academyApi.revokeSession(id);setSessions(current=>current.filter(session=>session.id!==id));setMessage('تم إنهاء الجلسة بنجاح.')}catch{setMessage('تعذر إنهاء الجلسة. حاول مرة أخرى.')}};
  const exportData=async()=>{setMessage('جارٍ تجهيز نسخة بياناتك...');try{const data=await academyApi.exportAccount();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`yasser-ai-account-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);setMessage('تم تنزيل نسخة بيانات الحساب.')}catch{setMessage('تعذر تصدير البيانات الآن.')}};
  const remove=async(event:FormEvent)=>{event.preventDefault();if(!confirmed)return;setMessage('جارٍ حذف الحساب...');try{await academyApi.deleteAccount(password);go('home')}catch(error){setMessage(error instanceof ApiError&&error.status===401?'كلمة المرور غير صحيحة.':'تعذر حذف الحساب. حاول مرة أخرى.')}};
  return <main className="dashboard-layout"><SideNav go={go}/><div className="dash-main"><div className="dash-top"><div><span>إعدادات الحساب</span><h1>الخصوصية والأجهزة</h1></div><button className="secondary" onClick={()=>go('dashboard')}>العودة للوحة</button></div>
    {message&&<div className={message.startsWith('تم')?'feedback good':'feedback bad'} role="status">{message}</div>}
    <section className="dash-section"><div className="title-row"><div><span className="eyebrow">جلسات الدخول</span><h2>الأجهزة المسجّل دخولها</h2></div><button className="secondary" onClick={loadSessions}>تحديث</button></div>
      {state==='loading'&&<p className="report-text" aria-busy="true">جارٍ تحميل الجلسات...</p>}
      {state==='error'&&<div className="feedback bad" role="alert">تعذر تحميل الجلسات.</div>}
      {state==='ready'&&sessions.length===0&&<p className="report-text">لا توجد جلسات أخرى نشطة.</p>}
      <div className="session-list">{sessions.map(session=><div key={session.id}><span><b>جلسة متصفح {session.current&&'• الحالية'}</b><small>تنتهي {new Date(session.expiresAt).toLocaleDateString('ar-EG')}</small></span><button className="secondary" disabled={session.current} onClick={()=>void revoke(session.id)}>{session.current?'الجلسة الحالية':'إنهاء الجلسة'}</button></div>)}</div>
    </section>
    <section className="dash-section"><div className="title-row"><div><span className="eyebrow">نسخة بياناتك</span><h2>تصدير بيانات الحساب</h2></div><button className="secondary" onClick={()=>void exportData()}><Download/> تنزيل JSON</button></div><p className="report-text">يتضمن الملف ملفك الشخصي والاشتراكات والطلبات والتقدم والاختبارات والمشروعات.</p></section>
    <section className="dash-section danger-zone"><span className="eyebrow">منطقة خطرة</span><h2>حذف الحساب نهائيًا</h2><p className="report-text">سيتم إلغاء كل الجلسات وإخفاء بياناتك الشخصية. تُحفظ السجلات المالية الضرورية وفق المتطلبات القانونية.</p><form onSubmit={remove}><label>كلمة المرور<input type="password" required minLength={8} value={password} onChange={event=>setPassword(event.target.value)}/></label><label className="check-label"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> أفهم أن هذا الإجراء لا يمكن التراجع عنه.</label><button className="secondary delete-action" disabled={!confirmed||password.length<8}><Trash2/> حذف الحساب</button></form></section>
  </div></main>;
}

function Notifications({go}:{go:(v:View)=>void}){
  type Notification = {id:string;type:string;title:string;body:string;read_at:string|null;created_at:string};
  const [items,setItems]=useState<Notification[]>([]);
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [message,setMessage]=useState('');
  useEffect(()=>{let active=true;academyApi.notifications().then(result=>{if(active){setItems(result.data);setState('ready')}}).catch(()=>{if(active)setState('error')});return()=>{active=false}},[]);
  const read=async(item:Notification)=>{
    if(item.read_at)return;
    setMessage('');
    try{await academyApi.markNotificationRead(item.id);setItems(current=>current.map(entry=>entry.id===item.id?{...entry,read_at:new Date().toISOString()}:entry))}
    catch{setMessage('تعذر تحديث الإشعار. حاول مرة أخرى.')}
  };
  return <main className="dashboard-layout"><SideNav go={go}/><div className="dash-main"><div className="dash-top"><div><span>مركز الإشعارات</span><h1>تنبيهاتك المهمة</h1></div><button className="secondary" onClick={()=>go('dashboard')}>العودة للوحة</button></div>
    <section className="dash-section">
      {state==='loading'&&<div className="loading-state" role="status">جارٍ تحميل الإشعارات...</div>}
      {state==='error'&&<div className="feedback bad" role="alert">تعذر تحميل الإشعارات. تأكد من اتصال الخادم ثم أعد المحاولة.</div>}
      {state==='ready'&&items.length===0&&<div className="empty-state"><Bell/><h2>لا توجد إشعارات جديدة</h2><p>سنظهر هنا فقط التنبيهات المرتبطة بتعلمك وحسابك.</p></div>}
      {state==='ready'&&items.length>0&&<div className="session-list">{items.map(item=><article key={item.id} className={item.read_at?'':'unread'}><span><b>{item.title}</b><small>{item.body}</small><small>{new Date(item.created_at).toLocaleString('ar-EG')}</small></span><button className="secondary" disabled={Boolean(item.read_at)} onClick={()=>void read(item)}>{item.read_at?'تمت القراءة':'تحديد كمقروء'}</button></article>)}</div>}
      {message&&<div className="feedback bad" role="alert">{message}</div>}
    </section>
  </div></main>;
}

function Assistant(){
  const[open,setOpen]=useState(false);
  const[input,setInput]=useState('');
  const[messages,setMessages]=useState<Array<{role:'assistant'|'user';text:string}>>([
    {role:'assistant',text:'أهلًا! أنا مرشدك الذكي. أشرح لك البرمجة والذكاء الاصطناعي، وأتابع تقدّمك إذا كنت مسجّلًا. كيف أساعدك؟'},
  ]);
  const[loading,setLoading]=useState(false);
  const ask=async(text=input)=>{
    if(!text.trim())return;
    const question=text.trim();
    setMessages(items=>[...items,{role:'user',text:question}]);
    setInput('');
    setLoading(true);
    try{
      const response=await academyApi.tutorMessage(question);
      setMessages(items=>[...items,{role:'assistant',text:response.data.message}]);
    }catch(error){
      const errorMessage=error instanceof ApiError&&error.code==='AI_SENSITIVE_DATA'
          ?'لحماية خصوصيتك، احذف البريد أو رقم الهاتف من رسالتك ثم أرسل السؤال مجددًا.'
          :error instanceof ApiError&&error.code==='AI_CONTENT_BLOCKED'
            ?'لا أستطيع المساعدة في هذا الطلب، لكن يمكنني مساعدتك في سؤال تعليمي آمن.'
            :'تعذر الوصول إلى المساعد الآن. تأكد من تشغيل الـAPI ثم حاول مرة أخرى.';
      setMessages(items=>[...items,{role:'assistant',text:errorMessage}]);
    }finally{setLoading(false)}
  };
  return <div className="assistant"><button className="assistant-btn" aria-label={open?'إغلاق المرشد الذكي':'اسأل مُرشدك الذكي'} onClick={()=>setOpen(!open)}><Bot/>{!open&&<span>اسأل مُرشدك الذكي</span>}</button>{open&&<div className="assistant-panel assistant-chat"><div className="assistant-head"><span><Bot/> مُرشد inner <i/></span><button aria-label="إغلاق نافذة المرشد" onClick={()=>setOpen(false)}><X/></button></div><div className="chat-messages" aria-live="polite">{messages.map((item,index)=><p className={item.role} key={`${item.role}-${index}`}>{item.text}</p>)}{loading&&<p className="assistant typing">أفكر في أفضل إجابة<span>•••</span></p>}</div><div className="suggestions"><button onClick={()=>void ask('ما مستوى تقدمي؟')}>تقدّمي</button><button onClick={()=>void ask('اشرح لي أساسيات Python')}>شرح Python</button><button onClick={()=>void ask('ساعدني أختار المسار المناسب')}>اختيار المسار</button></div><label><span className="sr-only">سؤالك للمرشد</span><input value={input} maxLength={1500} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void ask()}}} placeholder="اسألني أي شيء عن تعلّمك..."/><button aria-label="إرسال السؤال" disabled={loading||!input.trim()} onClick={()=>void ask()}><ArrowLeft/></button></label><small className="assistant-privacy"><ShieldCheck/> يستخدم بيانات تعلّمك المصرح بها فقط لتخصيص المساعدة</small></div>}</div>
}

function Footer({go}:{go:(v:View)=>void}){return <footer><div className="brand"><span className="brand-mark"><InnerMark/></span><span><b>{APP.name}</b><small>تعلم اليوم. ابنِ الغد.</small></span></div><div><b>المنصة</b><button onClick={()=>go('placement')}>اختبار المستوى</button><a href="#paths">المسارات</a><a href="#pricing">الأسعار</a></div><div><b>الدعم</b><a href={`mailto:${APP.support}`}>تواصل معنا</a><button onClick={()=>go('parent')}>ولي الأمر</button><span>الأسئلة الشائعة</span></div><div><b>قانوني</b><span>سياسة الخصوصية</span><span>الشروط والأحكام</span></div><p>© 2026 {APP.name}. صُممت الرحلة لطلاب يصنعون المستقبل.</p></footer>}
