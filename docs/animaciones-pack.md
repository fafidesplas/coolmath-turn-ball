# Auditoria de animaciones del pack "Hoops in Pixel"

Fuente (fuera del repo, solo consulta): `n3cloud-basketball-hoops-in-pixel/`.

- `Hoops_in_pixels_V2/characters/character.aseprite`: 422 frames de 64x64, 30 capas (piel, ropa,
  7 peinados, 5 barbas, cinta, balon, brazo superior, efectos...) y 57 etiquetas (55 animaciones mas
  `up` y `down`, que son las dos mitades de `Jump`). Es la fuente que usa el juego.
- `Hoops_in_pixel/Character/Character1_NEW.png` y `Character2_NEW.png` (+ versiones `_outline`): hojas
  V1 de 1856x1408 (29 columnas x 22 filas de 64x64), sin etiquetas.

El juego no copia el pack: `tools/pixel-art/export_atlas.py` recorta solo los frames usados y el
atlas se guarda cifrado (`tools/pixel-art/art.sealed`).

Columnas: **Antes** = usada en la version publicada anterior (commit 7446c71). **Ahora** = uso en esta
version. "Eleccion" significa que el jugador la elige como accion; "visible" que aparece sola en el
juego como consecuencia de algo.

## V2: etiquetas de `character.aseprite`

| Etiqueta | Frames | Antes | Ahora | Donde se ve |
|---|---|---|---|---|
| Idle | 0-4 | si | si (visible) | Atacante sin balon parado |
| Idle_2 | 5-9 | si | si (visible + eleccion) | Defensor en guardia; defensor plantado en "Take the charge" |
| Idle_Ball_1 | 10-14 | si | si (visible) | Reposo con balon al decidir (estilo segun jugador) |
| Idle_Ball_2 | 15-19 | no | si (visible) | Reposo con balon, otro estilo de jugador |
| Idle_Ball_3 | 20-24 | no | si (visible) | Reposo con balon, otro estilo de jugador |
| Idle_Ball_4 | 25-29 | no | si (visible) | Reposo con balon, otro estilo de jugador |
| Dribble_1 | 30-34 | si | si (visible) | Bote parado, diestros |
| Dribble_2 | 35-39 | no | si (visible) | Bote parado, diestros (variante) |
| Pocket_Dribble | 40-45 | si | si (eleccion) | Jugada "Clear-out" (1 contra 1) |
| Switch_Dribble_1 | 46-50 | si | si (especial) | Especial "Street Blaze" |
| Switch_Dribble_2 | 51-55 | no | si (visible) | Reposo con balon de un estilo de jugador (cambio de mano) |
| Dribble_1_Left | 56-60 | no | si (visible) | Bote parado, zurdos |
| Dribble_2_Left | 61-65 | no | si (visible) | Bote parado, zurdos (variante) |
| Dribbble_3_Left | 66-71 | no | si (eleccion) | Regate "Step-back" (sale hacia atras botando) |
| Jab | 72-77 | si | si (eleccion) | Pases normales, hand-off, dar y seguir |
| Between | 78-85 | si (solo especial) | si (eleccion) | Regate "Between the legs" (entre las piernas); especial "Pepper Dash" |
| Behind_Back | 86-93 | si (como spin) | si (eleccion) | Regate "Behind the back" (por la espalda); especial "Noodle Spin" |
| Side_Step | 94-103 | si | si (eleccion) | Regate "Euro step"; especial "Breeze Step" |
| Hesi | 104-113 | si | si (eleccion) | Regate "Hesitation" |
| Crossover | 114-121 | si | si (eleccion) | Regate "Crossover"; ganar el 1 contra 1 del clear-out; especial "Rocket Cross" |
| Run | 122-127 | si | si (visible) | Correr sin balon (cortes, recolocacion) |
| Run_Ball | 128-133 | si | si (visible) | Correr con balon |
| Sprint | 134-139 | si | si (especial) | Especial "Blueprint Cut" |
| Sprint_Ball | 140-145 | si | si (visible) | Penetraciones; carrera hacia el aro antes de un mate; carrera que acaba en carga |
| Slide | 146-150 | si | si (visible) | Desplazamiento defensivo (Press, Deny, Contest) |
| Free_Throw | 151-159 | si | si (eleccion + visible) | Pase bombeado y pase cruzado (lob, skip); tiro libre tras un "and one" |
| Jumpshot | 160-171 | si | si (eleccion) | "Jump shot" de media distancia y tiro a tabla |
| Jumpshot_2 | 172-183 | si | si (eleccion) | "Three" (triple) desde detras de la linea |
| Jumpshot_3 | 184-195 | si (especial) | si (especial) | Especiales "Sunset Splash" y "Comet Three" |
| Back_Idle | 196-200 | no | si (visible) | Con balon en el poste, de espaldas al aro, al decidir |
| Back_Idle_2 | 201-205 | no | si (visible) | Igual, otro estilo de jugador |
| Back_Dribble | 206-210 | no | si (eleccion + visible) | Regate "Spin" (de espaldas, giro y salida); bote en el poste; final del "Back down" |
| Back_Down | 211-215 | si (especial) | si (eleccion) | Regate "Back down" (fuerza hacia el poste); especial "Bulldozer" |
| Fake_Fadeaway_Right | 216-233 | si (especial) | si (especial) | Especial "Ruby Fade" (finta y fadeaway) |
| Fadeaway_Left | 234-247 | si | si (eleccion) | Tiro "Fadeaway" |
| Jump_TwoFeet_Ball | 248-253 | si | si (visible) | Recepcion de un lob en el aire |
| Jump_OneFeet_Ball | 254-256 | si | si (eleccion) | "Pump fake" (finta de tiro); salto que acaba en carga |
| Dunk_1 | 257-265 | si (layup limpio) | si (eleccion) | Mate en el poste, estilo de algunos jugadores |
| Dunk_2 | 266-274 | no | si (eleccion) | Mate en el poste a dos manos, otros jugadores |
| Dunk_3 | 275-288 | si (especial) | si (eleccion + especial) | Mate volando desde el codo ("Running dunk"); especial "Tower Slam" |
| Dunk_4 | 289-298 | no | si (eleccion) | Mate en el poste, otros jugadores |
| Dunk_5 | 299-310 | si (especial) | si (eleccion + especial) | Mate volando desde el codo; especial "Skywalk" |
| Dunk_6 | 311-322 | no | si (eleccion) | Mate volando desde el codo, otros jugadores |
| Dunk_7 | 323-331 | si (especial) | si (eleccion + especial) | Mate en el poste (tomahawk); especial "Rim Quake" |
| Layup | 332-339 | si | si (eleccion) | "Layup" (bandeja) |
| Double_Clutch | 340-348 | si | si (visible) | Bandeja con falta ("and one") |
| Floater | 349-356 | si | si (eleccion) | "Floater"; especial "Wall Hook" |
| Jump (up, down) | 357-370 | no (exportada, sin uso) | si (visible) | Celebracion de los companeros tras cada canasta |
| Steal | 371-376 | si | si (eleccion) | Defensa "Steal" (robo): el defensor mete la mano; robos y pases interceptados |
| Block_1 | 377-384 | si | si (eleccion) | Defensa "Block" (espera en el aro y salta); "Press" salta al tiro; el defensor que muerde la finta |
| Block_2 | 385-392 | no | si (eleccion) | Defensa "Contest" (mano arriba sobre el tirador) |
| Block_3 | 393-400 | no (exportada, sin uso) | si (eleccion) | Tapon conseguido ("STUFFED" / "BLOCKED", con su efecto de manotazo) |
| Rebound_1 | 401-407 | si | si (visible) | Rebote defensivo |
| Rebound_2 | 408-414 | no | si (visible) | Rebote ofensivo |
| Rebound_3 | 415-421 | no | si (visible) | El taponador recoge el balon despues del tapon |

Resumen: antes se exportaban 38 de 55 animaciones, dos de ellas (Jump, Block_3) sin usar, y varias solo aparecian en los especiales. Ahora se
exportan y se usan las 55. Las que el jugador elige directamente: 7 mates (segun jugador y distancia),
bandeja, floater, tiro, triple, fadeaway, 8 regates (crossover, entre las piernas, por la espalda,
spin, euro step, back down, hesitation, step-back), pump fake, pases y 7 defensas.

### Lo que el pack no tiene y como se resuelve

| Accion pedida | Animacion en el pack | Solucion |
|---|---|---|
| Spin | No hay etiqueta "Spin" | `Back_Dribble` (de espaldas al defensor) y el sprite gira a mitad de movimiento hacia el destino, con una rafaga de viento. Antes se usaba `Behind_Back`, que ahora es su propio regate. |
| Euro step | No hay etiqueta propia | `Side_Step` (dos pasos laterales), que es el movimiento mas cercano. |
| Cargar la falta | No hay caida ni "flop" | El defensor se planta (`Idle_2`), el atacante choca (`Sprint_Ball` o `Jump_OneFeet_Ball`), temblor, polvo, el defensor sale despedido y queda aturdido, silbato y rotulo "CHARGE". No se ha dibujado ninguna hoja nueva. |
| Dar espacio / Denegar pase | No son animaciones de jugador | Se ven por la colocacion: el defensor se separa o se mete en la linea de pase (`Slide`), con anillos y lineas en la pista. |

## V1: hojas `Character1_NEW.png` / `Character2_NEW.png`

Son la primera version del pack: 22 filas sin etiquetas, otro personaje (camiseta blanca, pelo
distinto) y sin capas separadas. No se pueden recolorear por equipo ni combinar con los peinados de
V2, y los mismos movimientos existen en V2 con mas variantes. No se usan; se listan para que la
auditoria este completa.

| Fila | Frames | Contenido (inspeccion visual) | Equivalente V2 usado |
|---|---|---|---|
| 0 | 4 | Reposo sin balon | Idle |
| 1 | 5 | Reposo con balon | Idle_Ball_1..4 |
| 2 | 23 | Cadena de botes y cambios de mano | Dribble_*, Switch_Dribble_* |
| 3 | 7 | Tiro parado / tiro libre | Free_Throw |
| 4 | 8 | Finta y pivote con balon | Jab |
| 5 | 7 | Bote con cambio de mano | Crossover |
| 6 | 14 | Combinacion de botes por debajo de las piernas | Between |
| 7 | 17 | Combinacion de botes que acaba en salto con polvo | Hesi + Jumpshot |
| 8 | 7 | Bote lateral | Side_Step |
| 9 | 29 | Secuencia larga de botes y giro | Behind_Back, Back_Dribble |
| 10-11 | 5 + 5 | Bote parado (variantes) | Dribble_1 / Dribble_2 |
| 12-16 | 15, 15, 14, 18, 15 | Bote que acaba en tiro en suspension, bandeja o mate | Jumpshot_*, Layup, Dunk_* |
| 17-18 | 5 + 5 | Guardia defensiva | Idle_2 |
| 19 | 7 | Desplazamiento defensivo | Slide |
| 20 | 4 | Robo | Steal |
| 21 | 6 | Tapon | Block_1..3 |

## Otros recursos del pack

| Recurso | Uso |
|---|---|
| `court/court.png` | Recortes de pista, canasta, aro y red |
| `ball/ball.png`, `ball_1.png`, `ball_2.png` | Balon en vuelo (tres frames de giro) |
| `decor/Decor.png`, `decor/Grass.png` | Farolas, valla, bancos, papelera, botella, monopatin, cesped |
| `characters/Character_Customizer.exe` | No se usa ni se copia (es una herramienta, no arte) |
| `Hoops_in_pixels.zip` | No se usa ni se copia |

## Usos nuevos (camara suave y jugadas combinadas)

Sin hojas ni recortes nuevos: el atlas es el mismo y se reutilizan animaciones que ya estaban exportadas.

| Etiqueta | Uso nuevo |
|---|---|
| Sprint | Carreras sin balon a toda velocidad: el finalizador del alley-oop, la ayuda que llega al aro, la carrera al rebote, los companeros que van a celebrar |
| Jump_TwoFeet_Ball | Despegue del alley-oop (el finalizador salta antes de que llegue el balon) |
| Dunk_1 a Dunk_7 | Mate en el aire del alley-oop y finales de las combinadas (cada jugador con su mate) |
| Free_Throw | Pase bombeado del alley-oop, tambien el pase al tablero |
| Jab, Free_Throw | Pases de las combinadas (give and go, kick-out, backdoor, drive and dish, swing) |
| Rebound_1, Rebound_2, Block_1 | Rebote disputado: el que lo gana con Rebound, el rival estirandose con Block_1 |
| Jump | Espectadores que celebran; companeros que corren hacia el anotador y saltan |
| Idle | Espectadores en reposo |
| Run, Slide | Movimiento sin balon mientras decides (V-cuts y el defensor que sigue) |
