import { Context } from '@cordisjs/client'
import YoutubeCard from './YoutubeCard.vue'
import YoutubeLoadCard from './YoutubeLoadCard.vue'

export default (ctx: Context) => {
  ctx.inject(['manager'], (ctx) => {
    ctx.client.router.slot({
      type: 'plugin-details',
      component: YoutubeCard,
      order: -100
    })
  })

  ctx.client.router.slot({
    type: 'home',
    component: YoutubeLoadCard,
    order: 899
  })
}
