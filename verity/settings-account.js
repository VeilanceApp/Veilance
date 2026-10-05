const el=id=>document.getElementById(id);
let busy=false;
async function send(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.error||'Account request failed.');return r;}
function render(user){
 el('accountSignIn').hidden=!!user;el('accountDetails').hidden=!user;el('accountSignOut').hidden=!user;
 el('accountVerify').hidden=!user || user.verified===true;el('accountPlans').hidden=!user || user.plan?.toLowerCase()!=='free';
 for(const [id,value] of Object.entries({accountEmail:user?.email,accountId:user?.user_id,accountPlan:user?.plan,accountEnabled:user?.enabled_account?'Active':'Disabled',accountVerified:user?.verified?'Verified':'Not verified'}))el(id).textContent=value||'—';
}
async function run(fn){if(busy)return;busy=true;for(const button of el('settingsPanelAccount').querySelectorAll('button'))button.disabled=true;el('accountMessage').textContent='Checking account…';try{await fn();}catch(e){el('accountMessage').textContent=e.message;}finally{busy=false;el('accountPassword').value='';for(const button of el('settingsPanelAccount').querySelectorAll('button'))button.disabled=false;}}
async function refresh(){const {user}=await send('VERITY_ACCOUNT');render(user);el('accountMessage').textContent=!user?'Sign in to manage your account.':!user.verified?'Email not verified. Enter your email code on the website, then check again.':'Account details are up to date.';}
el('accountRefresh').addEventListener('click',()=>run(refresh));
el('settingsTabAccount').addEventListener('click',()=>run(refresh));
el('accountLoginForm').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{await send('VERITY_LOGIN',{email:el('accountEmailInput').value.trim(),password:el('accountPassword').value});await refresh();});});
el('accountWebsiteLogin').addEventListener('click',()=>run(async()=>{await send('VERITY_WEBSITE_LOGIN');await refresh();}));
el('accountSignOut').addEventListener('click',()=>run(async()=>{await send('VERITY_SIGNOUT');await refresh();}));
addEventListener('hashchange',()=>{if(location.hash==='#account')void run(refresh);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!el('settingsPanelAccount').hidden)void run(refresh);});
if(location.hash==='#account')void run(refresh);
