/* Applies the saved appearance before the first paint, so the window never
   flashes the wrong theme on the way in.

   A file rather than an inline <script>: the page carries a Content Security
   Policy of script-src 'self', which refuses inline script outright. That rule
   is Reader's second lock on a booby-trapped document -- the first being the
   sanitiser -- and it is only worth having if nothing needs an exception.
   Loaded without defer, so it still runs ahead of the first paint. */
/* Apply saved appearance before first paint so there is no flash. */
(function(){try{
  var p=JSON.parse(localStorage.getItem("mdview.v2")||localStorage.getItem("mdview.v1")||"{}"),
      r=document.documentElement,t=p.theme||"auto";
  r.dataset.themepref=t;
  r.dataset.theme=t==="auto"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;
  if(p.side)r.dataset.side=p.side;
  if(p.mode)r.dataset.mode=p.mode;
  if(p.paper)r.dataset.paper=p.paper;
  if(p.paperDark)r.dataset.paperDark=p.paperDark;
  if(p.codeTheme)r.dataset.code=p.codeTheme;
  r.dataset.sidebar=p.hidden?"hidden":"shown";
  if(p.width)r.style.setProperty("--sidebar-w",p.width+"px");
}catch(e){}})();
