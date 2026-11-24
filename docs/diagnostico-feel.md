# Diagnostico de feel: que le falta a Turn Ball Pixel

Punto de partida: la version publicada del commit 19dbc90 (duelos como pantalla de batalla JRPG). Comentario de
Fafi al jugarla: "esta mejor pero sigue faltando algo", la camara "marea un poco", faltan "jugadas entre los
jugadores" y "es como que le falta mucho".

Lectura corta: el juego tiene buena profundidad de decision (probabilidades exactas, 7 defensas, especiales),
pero la pista se sentia como un tablero: solo se movian los dos jugadores del duelo, cada accion era un 1 contra
1 aislado, y entre decisiones no pasaba nada. En un arcade de baloncesto la sensacion viene de lo que pasa
alrededor de la decision: gente moviendose, el balon vivo, el publico, el impacto. Este documento lista lo que
falta, que se ha hecho en esta tanda y que queda para la siguiente.

## Diagnostico por area

| Area | Estado en 19dbc90 | Problema | En esta tanda |
|---|---|---|---|
| Camara | Corte seco a 3x en cada duelo y cada previa | Marea; cada movimiento del cursor recolocaba la vista | **Hecho**: transiciones suaves, modos Suave / Completa / Apagada, nitidez a pixel entero |
| Jugadas entre jugadores | Solo jugadas de un paso (pase, corte, pick and roll sin continuidad) | No se ven "jugadas": falta el pase al tablero y el mate, el dar y seguir... | **Hecho**: menu Combo con 7 jugadas combinadas |
| Movimiento sin balon | Los 4 jugadores sin balon quietos mientras decides | La pista parece una foto | **Hecho**: V-cuts y pasos de los companeros, sus defensores los siguen |
| Ritmo de una posesion | Decidir, mirar 2 s, decidir; tiempos muertos fijos | Lento y uniforme, sin picos | Parcial: las combinadas encadenan pasos mas rapidos (menos espera entre pasos) |
| Sonido y feedback | Pitido, red, aro, robo, choque | Sin bote del balon, sin zapatillas, sin publico; sin "golpe" en los mates | **Hecho**: bote al driblar, chirrido de zapatillas, publico, golpe de mate, hit-stop en mates y tapones |
| Celebraciones | Los companeros saltan en su sitio | Poca recompensa por anotar | **Hecho**: los companeros corren hacia el anotador y saltan, el anotador celebra |
| Rebotes | El reboteador va al punto y lo coge | No hay pelea por el balon | **Hecho**: rebote disputado (carambola larga o corta, bote en el suelo a veces, bloqueo, dos jugadores saltan) |
| Contraataque / transicion | Cada posesion empieza en una formacion al azar | No se siente el cambio de posesion | Parcial: quien gana el balon (rebote, robo, tapon) lo saca botando hasta la linea |
| Publico y ambiente | Pista vacia con bancos | Sin vida alrededor | **Hecho**: espectadores con sprites del pack que celebran las jugadas grandes |
| Especial o remate de equipo | Solo especiales individuales | Falta un "momento de equipo" | Pendiente |
| Lo detectado al jugarlo | Etiquetas que se solapan en las combinadas; en moviles pequenos la quinta fila del menu queda oculta; el numero grande cambiaba de ancho al pasar el cursor | Ruido visual y una caja que se movia | **Hecho**: etiqueta de la jugada sobre el companero, flecha de "hay mas filas", ancho fijo del numero |

## Hecho en esta tanda (las 5 mejoras de feel de mas impacto)

1. **Movimiento sin balon.** Mientras decides, cada companero hace V-cuts o pasos laterales de medio metro y
   vuelve a su sitio cada 2 a 4 s, con la animacion de carrera; su defensor le sigue con el desplazamiento
   lateral. Pequeno a proposito: las previas y los toques en la pista siguen apuntando bien.
2. **Rebotes de verdad.** El balon sale del aro largo o corto hacia el lado del tiro (a veces bota en el suelo
   antes), los jugadores cercanos van a por el, el defensor bloquea, y los dos mas cercanos saltan: el que lo
   gana con Rebound_1 o Rebound_2, el otro estirandose con Block_1. El resultado sigue siendo el de las reglas.
3. **Publico y celebraciones.** Cinco espectadores (personajes del pack con ropa de calle, sin marca de equipo)
   detras de la canasta y en los bancos; saltan con la animacion Jump en canastas, mates y tapones. Al anotar,
   los companeros corren hacia el anotador y saltan; el anotador celebra al caer.
4. **Feedback de impacto y sonido.** Hit-stop (la imagen se congela unas centesimas) en mates y tapones; bote
   del balon cuando el jugador avanza botando; chirrido de zapatillas en cortes y ayudas; rugido del publico
   en canastas, "ooh" en tapones; golpe grave en los mates. Con FX bajo no hay hit-stop.
5. **Transicion.** Quien gana el balon (rebote defensivo, robo, tapon) es el que lo sube: sale botando a
   velocidad hasta su posicion de ataque mientras los demas trotan.

Ademas, fuera de esta lista: la camara nueva y las jugadas combinadas (ver README).

## Pendiente para la siguiente tanda (ordenado por impacto)

1. **Remate de equipo ("team special").** Con el medidor Fire lleno, o tras una combinada que salga
   perfecta, un remate de los tres jugadores con cinematica propia (por ejemplo, alley-oop de tres
   con pase al tablero, toque y mate). Necesita reglas nuevas en rules.ts y pasar por el simulador.
2. **Contraataque real.** Tras robo o tapon, una ventana de ventaja (2 contra 1 o 3 contra 2) antes de que la
   defensa se recoloque: una decision rapida con probabilidades propias. Cambia el equilibrio, asi que va con
   `npm run sim` y su calibracion.
3. **Combinadas del rival.** Ahora la IA ataca con jugadas sueltas; cuando defiendes no ves alley-oops ni
   picks con continuidad. Hay que meter las combinadas en el modelo de ataque de la IA y ensenar en el menu
   de defensa contra que jugada combinada defiendes.
4. **Ritmo.** Reloj de posesion visible (las 4 jugadas como barra que se gasta con animacion), "ultima
   jugada" con tension (musica o latido), y acortar los tiempos muertos entre posesiones.
5. **Musica.** No hay musica; un bucle chiptune por pantalla (menu, partido, momento decisivo) daria mucha
   vida. Requiere componerla o usar una libreria con licencia clara.
6. **Ambiente de pista.** Publico que reacciona tambien a fallos y robos del rival (abucheo), banquillo con
   suplentes, iluminacion de atardecer que cambia con el marcador.
7. **Celebraciones con personalidad.** Una celebracion por jugador (como su mate propio), choque de manos
   real entre dos sprites, y una animacion de frustracion del defensor batido (el pack no tiene una: habria
   que usar Idle_2 con un "suspiro" de particulas o pedir permiso para editar frames).
8. **Movimiento sin balon durante la jugada.** Ahora los jugadores no implicados se quedan quietos mientras se
   resuelve una accion; deberian abrir espacio, pedir el balon o cortar.
9. **Lectura de la defensa en las combinadas.** Ensenar, antes de elegir, que reaccion probable tendra la
   defensa en cada paso (ayuda, cambio, anticipacion), no solo el resultado global.
10. **Tutorial de combinadas.** Una leccion guiada para el alley-oop y el pick and roll.
