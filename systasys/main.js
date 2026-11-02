import * as Cesium from 'cesium'
import { FEEDS, normalize, filterPoints } from './model.js'
import './style.css'
Cesium.buildModuleUrl.setBaseUrl('/n4/worlds-eye-app/cesium/')
const $=id=>document.getElementById(id)
const state={points:[],enabled:new Set(Object.keys(FEEDS)),period:'fresh',viewer:null,requestId:0}
const fmt=date=>new Date(date).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'})
function select(item){
 $('event-title').textContent=item.title
 $('event-body').textContent=item.freshness==='FRESH'?'Observation récente vérifiée.':'Observation datée, non assimilable à une alerte actuelle.'
 $('event-meta').textContent=FEEDS[item.source].label+' · '+fmt(item.at)+' · '+item.freshness
 $('event-source').hidden=false;$('event-source').href=item.url
 if(state.viewer)state.viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(item.lon,item.lat,1800000),duration:1.1})
}
function render(){
 const filtered=filterPoints(state.points,state.period,state.enabled)
 $('stat-visible').textContent=String(filtered.length)
 $('layer-count').textContent=String(state.enabled.size)
 $('count-usgs').textContent=String(state.points.filter(p=>p.source==='usgs_earthquakes_global_free').length)
 $('count-gdacs').textContent=String(state.points.filter(p=>p.source==='gdacs_global_disasters_free').length)
 if(state.viewer){
   state.viewer.entities.removeAll()
   for(const item of filtered){
     const entity=state.viewer.entities.add({id:item.id,name:item.title,position:Cesium.Cartesian3.fromDegrees(item.lon,item.lat),point:{pixelSize:10,color:Cesium.Color.fromCssColorString(FEEDS[item.source].color),outlineColor:Cesium.Color.WHITE,outlineWidth:1,disableDepthTestDistance:Number.POSITIVE_INFINITY}})
     entity.eyeRecord=item
   }
   state.viewer.scene.requestRender()
 }
 const list=$('event-list');list.replaceChildren()
 for(const item of filtered.slice(0,40)){
   const b=document.createElement('button');b.type='button'
   b.textContent=item.title+' · '+fmt(item.at)+' · '+item.freshness
   b.addEventListener('click',()=>select(item))
   list.append(b)
 }
 $('foot-status').textContent=filtered.length?String(filtered.length)+' observations géolocalisées prouvées':'Aucun point admissible dans cette sélection'
}
async function readData(){
 const id=++state.requestId
 $('refresh').disabled=true;$('connection').textContent='Lecture SPECTRA en cours'
 let timer
 let listener
 try{
   const result=await new Promise((resolve,reject)=>{
     timer=setTimeout(()=>reject(new Error('TIMEOUT')),8000)
     listener=e=>{
       if(e.source!==window.parent||e.origin!==window.location.origin||e.data?.type!=='SYSTASYS_EYE_REPLY_V1'||e.data?.id!==id)return
       resolve(e.data)
     }
     window.addEventListener('message',listener)
     window.parent.postMessage({type:'SYSTASYS_EYE_READ_V1',id},window.location.origin)
   })
   if(!result.ok)throw Error('READ_REFUSED')
   const model=normalize(result,Date.now())
   state.points=model.points
   $('stat-total').textContent=String(model.total)
   $('stat-other').textContent=String(Math.max(0,model.total-model.points.length))
   $('connection').textContent='SPECTRA · relevé vérifié'
 }catch{
   state.points=[]
   $('stat-total').textContent='—';$('stat-other').textContent='—'
   $('connection').textContent='SPECTRA indisponible · aucune donnée affirmée'
 }finally{
   clearTimeout(timer);if(listener)window.removeEventListener('message',listener)
   $('refresh').disabled=false;render()
 }
}
function startGlobe(){
 try{
   const viewer=new Cesium.Viewer('globe',{terrainProvider:new Cesium.EllipsoidTerrainProvider(),baseLayer:false,animation:false,timeline:false,geocoder:false,homeButton:false,baseLayerPicker:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,skyBox:false,skyAtmosphere:false,requestRenderMode:true})
   state.viewer=viewer
   viewer.scene.globe.baseColor=Cesium.Color.fromCssColorString('#284450')
   viewer.scene.globe.show=true
   viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(10,12,23000000)})
   viewer.selectedEntityChanged.addEventListener(entity=>{if(entity?.eyeRecord)select(entity.eyeRecord)})
   viewer.scene.requestRender()
   $('foot-status').textContent='CesiumJS opérationnel · observations à charger'
 }catch{$('fatal').hidden=false;$('foot-status').textContent='WebGL indisponible'}
}
for(const [name,id] of [['usgs_earthquakes_global_free','layer-usgs'],['gdacs_global_disasters_free','layer-gdacs']]){
 $(id).addEventListener('change',e=>{if(e.target.checked)state.enabled.add(name);else state.enabled.delete(name);render()})
}
document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{
 state.period=b.dataset.period
 document.querySelectorAll('[data-period]').forEach(q=>q.setAttribute('aria-pressed',String(q===b)))
 render()
}))
$('refresh').addEventListener('click',readData)
$('home').addEventListener('click',()=>state.viewer?.camera.flyHome(1.1))
$('zoom-in').addEventListener('click',()=>state.viewer?.camera.zoomIn(1000000))
$('zoom-out').addEventListener('click',()=>state.viewer?.camera.zoomOut(1000000))
startGlobe()
