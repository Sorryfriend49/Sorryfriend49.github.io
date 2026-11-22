-- =====================================================================
-- FROZEN PROJECT: prueba de seguridad de la base de datos
-- Se pega en Supabase → SQL Editor → Run. Crea dos usuarios de prueba, comprueba
-- las reglas y al final lanza un "error" a propósito con los resultados: así
-- Postgres deshace todo y no queda nada guardado.
-- =====================================================================
do $$
declare
    u1 uuid := gen_random_uuid();
    u2 uuid := gen_random_uuid();
    r  text := '';
    n  int;
    e  text;
begin
    r := r || 'rol del editor: ' || current_user
           || '; puede borrar en auth.users: ' || has_table_privilege(current_user, 'auth.users', 'DELETE') || E'\n';
    insert into auth.users (id, email, aud, role)
    values (u1, 'prueba1@example.com', 'authenticated', 'authenticated'),
           (u2, 'prueba2@example.com', 'authenticated', 'authenticated');

    -- Usuario 1
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.biblioteca (usuario, obra, estado, favorito, agregada, cambiada)
    values (u1, 'chainsaw-man', 'leyendo', false, '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z');
    insert into public.biblioteca (usuario, obra, estado, favorito, agregada, cambiada)
    values (u1, 'chainsaw-man', 'leido', true, '2026-11-20T10:00:00Z', '2026-11-21T10:00:00Z')
    on conflict (usuario, obra) do update set estado = excluded.estado, favorito = excluded.favorito,
        borrada = excluded.borrada, agregada = excluded.agregada, cambiada = excluded.cambiada;
    insert into public.biblioteca (usuario, obra, estado, favorito, agregada, cambiada)
    values (u1, 'chainsaw-man', 'abandonado', false, '2026-11-20T10:00:00Z', '2026-11-19T10:00:00Z')
    on conflict (usuario, obra) do update set estado = excluded.estado, favorito = excluded.favorito,
        borrada = excluded.borrada, agregada = excluded.agregada, cambiada = excluded.cambiada;
    select estado || '/' || favorito into e from public.biblioteca where obra = 'chainsaw-man';
    r := r || 'gana el cambio más reciente: ' || e || E' (esperado leido/true)\n';

    insert into public.biblioteca (usuario, obra, estado, cambiada) values (u1, 'berserk', 'por-leer', '2030-01-01');
    select (cambiada < now() + interval '1 minute')::text into e from public.biblioteca where obra = 'berserk';
    r := r || 'fecha del futuro corregida: ' || e || E'\n';
    update public.biblioteca set borrada = true, estado = null, favorito = false, cambiada = now() where obra = 'berserk';

    begin
        insert into public.biblioteca (usuario, obra) values (u1, 'one-piece');
        r := r || E'FALLO: aceptó una obra sin etiqueta ni favorito\n';
    exception when check_violation then r := r || E'rechaza obra vacía: ok\n';
    end;
    begin
        insert into public.biblioteca (usuario, obra, estado) values (u1, 'Mal ID', 'leyendo');
        r := r || E'FALLO: aceptó un id raro\n';
    exception when check_violation then r := r || E'rechaza id raro: ok\n';
    end;
    begin
        insert into public.biblioteca (usuario, obra, estado) values (u1, 'one-piece', 'leyendisimo');
        r := r || E'FALLO: aceptó una etiqueta rara\n';
    exception when check_violation then r := r || E'rechaza etiqueta rara: ok\n';
    end;
    select count(*) into n from public.biblioteca;
    r := r || 'usuario 1 ve ' || n || E' filas (esperado 2)\n';

    -- Usuario 2 no ve ni toca lo del usuario 1
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.biblioteca;
    r := r || 'usuario 2 ve ' || n || E' filas (esperado 0)\n';
    begin
        insert into public.biblioteca (usuario, obra, estado) values (u1, 'naruto', 'leyendo');
        r := r || E'FALLO: el usuario 2 escribió en la biblioteca del 1\n';
    exception when insufficient_privilege then r := r || E'usuario 2 no puede escribir en la del 1: ok\n';
    end;
    update public.biblioteca set estado = 'abandonado', cambiada = now() + interval '1 hour' where usuario = u1;
    get diagnostics n = row_count;
    r := r || 'usuario 2 cambió ' || n || E' filas del 1 (esperado 0)\n';

    -- Sin sesión (anon) no hay nada
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
    begin
        select count(*) into n from public.biblioteca;
        r := r || E'FALLO: anon pudo leer\n';
    exception when insufficient_privilege then r := r || E'anon no puede leer: ok\n';
    end;
    begin
        perform public.borrar_mi_cuenta();
        r := r || E'FALLO: anon pudo llamar a borrar_mi_cuenta\n';
    exception when insufficient_privilege then r := r || E'anon no puede borrar cuentas: ok\n';
    end;

    -- El usuario 1 borra su cuenta
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        perform public.borrar_mi_cuenta();
        execute 'reset role';
        select count(*) into n from auth.users where id = u1;
        r := r || 'cuenta del usuario 1 borrada: ' || (n = 0) || '; ';
        select count(*) into n from public.biblioteca where usuario = u1;
        r := r || 'filas que le quedan: ' || n || E' (esperado 0)\n';
    exception when others then
        r := r || 'FALLO al borrar la cuenta: ' || sqlerrm || E'\n';
    end;

    raise exception E'RESULTADOS (todo se deshace)\n%', r;
end $$;
